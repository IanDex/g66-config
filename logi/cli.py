import base64
import json
import subprocess
import sys
import click
from rich.console import Console
from rich.table import Table
from rich import print as rprint

from db import get_companies, get_users, get_countries, find_user_by_email, get_company_full, get_user_status
from auth import login_cognito, reset_password

console = Console()


def _copy_to_clipboard(text: str):
    try:
        subprocess.run("clip", input=text.encode("utf-16"), check=True, shell=True)
        console.print("[dim]📋 Copiado al clipboard.[/dim]")
    except Exception as e:
        console.print(f"[yellow]No se pudo copiar al clipboard: {e}[/yellow]")


def _decode_jwt(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload = parts[1]
    payload += "=" * (4 - len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def _print_tokens(resp: dict, copy: bool, decode: bool):
    id_token = resp.get("idToken") or resp.get("id_token")
    next_step = resp.get("nextStep")

    if next_step:
        console.print(f"\n[yellow]nextStep = {next_step}[/yellow]")
        console.print("[yellow]El servidor requiere paso adicional. "
                      "Revisá si el usuario tiene OTP activo en este env.[/yellow]")

    if id_token:
        console.print("\n[green bold]ID TOKEN[/green bold]")
        console.print(id_token)
        if copy:
            _copy_to_clipboard(id_token)
        if decode:
            claims = _decode_jwt(id_token)
            console.print("\n[bold cyan]JWT CLAIMS[/bold cyan]")
            for k, v in claims.items():
                if k == "exp":
                    import datetime
                    v = f"{v}  ({datetime.datetime.fromtimestamp(v).strftime('%Y-%m-%d %H:%M:%S')})"
                console.print(f"  [dim]{k}:[/dim] {v}")
    else:
        console.print("\n[yellow]Respuesta completa:[/yellow]")
        rprint(resp)


def _do_login(env: str, email: str, password: str, copy: bool, decode: bool):
    console.print(f"\nAutenticando [bold]{email}[/bold] en [[bold]{env}[/bold]]...")
    try:
        resp = login_cognito(env, email, password)
    except Exception as exc:
        if "Incorrect username or password" in str(exc):
            console.print("[yellow]Contraseña incorrecta — reseteando a Global66...[/yellow]")
            try:
                reset_password(env, email, password)
                console.print("[dim]Password reseteada. Reintentando login...[/dim]")
                resp = login_cognito(env, email, password)
            except Exception as exc2:
                console.print(f"[red]Error tras reset:[/red] {exc2}")
                sys.exit(1)
        else:
            console.print(f"[red]Error en login:[/red] {exc}")
            sys.exit(1)
    _print_tokens(resp, copy, decode)


@click.group()
def cli():
    """Logi — tokens B2B Global66 para dev/CI."""
    pass


@cli.command()
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--country", default=None)
@click.option("--status", default="APPROVED", show_default=True)
@click.option("--json", "as_json", is_flag=True, default=False, hidden=True)
def companies(env, country, status, as_json):
    """Lista compañías aprobadas."""
    rows = get_companies(env, country, status)
    if as_json:
        print(json.dumps(rows, default=str))
        return
    if not rows:
        console.print(f"[yellow]Sin resultados[/yellow]")
        return
    table = Table(title=f"Compañías [{env}]  kyc_stage_1={status}", show_lines=False)
    for col in ("company_id", "name", "country", "kyc_stage_1", "kyc_stage_2", "compliance_status"):
        table.add_column(col, no_wrap=col == "company_id")
    for r in rows:
        table.add_row(*[str(r.get(c) or "") for c in
                        ("company_id", "name", "country", "kyc_stage_1", "kyc_stage_2", "compliance_status")])
    console.print(table)
    console.print(f"Total: [bold]{len(rows)}[/bold]")


@cli.command()
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--company-id", required=True, type=int)
@click.option("--json", "as_json", is_flag=True, default=False, hidden=True)
def users(env, company_id, as_json):
    """Lista usuarios activos de una compañía."""
    rows = get_users(env, company_id)
    if as_json:
        print(json.dumps(rows, default=str))
        return
    if not rows:
        console.print("[yellow]Sin usuarios activos[/yellow]")
        return
    table = Table(title=f"Usuarios compañía {company_id} [{env}]")
    for col in ("user_id", "email", "status", "is_legal_representative"):
        table.add_column(col)
    for r in rows:
        table.add_row(*[str(r.get(c) or "") for c in
                        ("user_id", "email", "status", "is_legal_representative")])
    console.print(table)


@cli.command()
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--json", "as_json", is_flag=True, default=False, hidden=True)
def countries(env, as_json):
    """Lista países con compañías aprobadas."""
    result = get_countries(env)
    if as_json:
        print(json.dumps(result))
        return
    for c in result:
        console.print(c)


@cli.command()
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--id", "company_id", required=True, type=int)
@click.option("--json", "as_json", is_flag=True, default=False, hidden=True)
def company(env, company_id, as_json):
    """Vista completa de una compañía y sus usuarios."""
    data = get_company_full(env, company_id)
    if as_json:
        print(json.dumps(data, default=str))
        return
    c = data["company"]
    if not c:
        console.print(f"[red]Compañía {company_id} no encontrada[/red]")
        return

    console.print(f"\n[bold]{c['name']}[/bold]  id={c['company_id']}  país={c.get('country') or '?'}")
    console.print(f"  {c.get('identification_type')} {c.get('identification_number')}")
    console.print(f"  kyc_stage_1=[bold]{c.get('kyc_stage_1')}[/bold]"
                  f"  kyc_stage_2={c.get('kyc_stage_2')}"
                  f"  kyc_stage_3={c.get('kyc_stage_3')}")
    console.print(f"  compliance=[bold]{c.get('compliance_status')}[/bold]")
    console.print(f"  ubicación: {c.get('city')}, {c.get('state')}, {c.get('country')}")

    users_list = data["users"]
    if users_list:
        console.print(f"\n[bold]Usuarios ({len(users_list)}):[/bold]")
        table = Table(show_lines=False)
        for col in ("user_id", "email", "status", "is_legal_representative"):
            table.add_column(col)
        for u in users_list:
            table.add_row(*[str(u.get(c) or "") for c in
                            ("user_id", "email", "status", "is_legal_representative")])
        console.print(table)
    else:
        console.print("\n[yellow]Sin usuarios[/yellow]")


@cli.command("find-user")
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--email", required=True)
@click.option("--json", "as_json", is_flag=True, default=False, hidden=True)
@click.option("--login", "do_login", is_flag=True, default=False)
@click.option("--no-copy", "copy", is_flag=True, default=True)
@click.option("--decode", "decode", is_flag=True, default=False)
def find_user(env, email, as_json, do_login, copy, decode):
    """Busca un usuario por email entre todas las compañías."""
    result = find_user_by_email(env, email)
    if as_json:
        print(json.dumps(result, default=str))
        return
    if not result:
        console.print(f"[red]Usuario '{email}' no encontrado en [{env}][/red]")
        sys.exit(1)

    console.print(f"\nUsuario: [bold]{result['email']}[/bold]  status={result['status']}")
    console.print(f"Empresa: [bold]{result['company_name']}[/bold]  id={result['company_id']}  país={result.get('country') or '?'}")
    console.print(f"kyc_stage_1={result['kyc_stage_1']}  compliance={result['compliance_status']}")

    if do_login:
        _do_login(env, email, None, copy, decode)


@cli.command()
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--country", default=None)
@click.option("--company-id", default=None, type=int)
@click.option("--email", default=None)
@click.option("--password", default=None)
@click.option("--status", default="APPROVED", show_default=True)
@click.option("--no-copy", "copy", is_flag=True, default=True, help="No copiar idToken al clipboard")
@click.option("--decode", "decode", is_flag=True, default=False, help="Mostrar JWT claims decodificados")
def token(env, country, company_id, email, password, status, copy, decode):
    """Obtiene idToken B2B."""

    if not email:
        with console.status(f"[dim]Buscando compañía [{env}]...[/dim]"):
            company_list = get_companies(env, country, status)
        if not company_list:
            console.print(f"[red]Sin compañías{' para ' + country if country else ''}[/red]")
            sys.exit(1)
        company = next((c for c in company_list if c["company_id"] == company_id), None) \
            if company_id else company_list[0]
        if not company:
            console.print(f"[red]Compañía {company_id} no encontrada[/red]")
            sys.exit(1)
        console.print(f"[dim]Empresa:[/dim] [bold]{company['name']}[/bold]  id={company['company_id']}")

        with console.status("[dim]Buscando usuario...[/dim]"):
            user_list = get_users(env, company["company_id"])
        if not user_list:
            console.print("[red]Sin usuarios activos.[/red]")
            sys.exit(1)
        email = user_list[0]["email"]
        console.print(f"[dim]Usuario:[/dim] [bold]{email}[/bold]")

    _do_login(env, email, password, copy, decode)


@cli.command()
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--email", required=True, help="Email del usuario")
@click.option("--json", "as_json", is_flag=True, default=False, hidden=True)
def status(env, email, as_json):
    """Pipeline completo de onboarding de un usuario y su empresa."""
    with console.status(f"[dim]Consultando [{env}]...[/dim]"):
        data = get_user_status(env, email)

    if as_json:
        print(json.dumps(data, default=str))
        return

    if not data:
        console.print(f"[red]Usuario '{email}' no encontrado en [{env}][/red]")
        sys.exit(1)

    def stage_color(val: str) -> str:
        if not val:
            return "[dim]—[/dim]"
        v = val.upper()
        if "APPROVED" in v:
            return f"[green bold]{val}[/green bold]"
        if "REJECTED" in v or "BLOCKED" in v:
            return f"[red bold]{val}[/red bold]"
        if "UPLOADED" in v or "ACTIVE" in v or "NORMAL" in v:
            return f"[cyan]{val}[/cyan]"
        if "REQUESTED" in v or "PENDING" in v or "REVISION" in v or "REVIEW" in v:
            return f"[yellow]{val}[/yellow]"
        return val

    console.print()
    console.rule(f"[bold]👤 Usuario — {data['email']}[/bold]")
    console.print(f"  Nombre:        {data['name']} {data['last_name']}")
    console.print(f"  Estado:        {stage_color(data['user_status'])}")
    console.print(f"  KYC personal:  {stage_color(data['user_kyc_stage_1'])}")
    console.print(f"  Tel verificado: {'✅' if data.get('verified_phone') else '❌'}")
    console.print(f"  Rep. legal:    {'✅' if data.get('is_legal_representative') else '❌'}")

    console.print()
    console.rule(f"[bold]🏢 Empresa — {data['company_name']}[/bold]")
    console.print(f"  ID:            {data['company_id']}")
    console.print(f"  Identificación: {data.get('identification_type')} {data.get('identification_number')}")
    console.print(f"  País:          {data.get('country') or '?'}  {data.get('city') or ''} {data.get('state') or ''}")

    console.print()
    console.rule("[bold]📋 Pipeline KYC[/bold]")

    stages = [
        ("KYC Stage 1", data.get("company_kyc_stage_1")),
        ("KYC Stage 2", data.get("company_kyc_stage_2")),
        ("KYC Stage 3", data.get("company_kyc_stage_3")),
        ("Compliance",  data.get("compliance_status")),
    ]
    for label, val in stages:
        console.print(f"  {label:<14} {stage_color(val or 'NONE')}")

    users = data.get("company_users", [])
    console.print()
    console.rule(f"[bold]👥 Usuarios de la empresa ({len(users)})[/bold]")
    table = Table(show_lines=False, box=None)
    for col in ("email", "status", "is_legal_representative"):
        table.add_column(col)
    for u in users:
        marker = "★ " if u.get("is_legal_representative") else "  "
        table.add_row(
            f"{marker}{u['email']}",
            stage_color(u.get("status") or ""),
            str(u.get("is_legal_representative") or ""),
        )
    console.print(table)
    console.print()


@cli.command("reset-password")
@click.option("--env", default="dev", type=click.Choice(["dev", "ci"]), show_default=True)
@click.option("--email", required=True)
@click.option("--password", default=None)
def reset_pwd(env, email, password):
    """Resetea password en Cognito (requiere IAM con aws configure)."""
    new_pwd = password or "Global66"
    console.print(f"Seteando password de [bold]{email}[/bold] → [bold]{new_pwd}[/bold] en [{env}]...")
    try:
        reset_password(env, email, new_pwd)
        console.print("[green]Password actualizada.[/green]")
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    cli()
