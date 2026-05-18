import pymysql
from config import CONFIGS


def _conn(env: str):
    cfg = CONFIGS[env]["company_db"]
    return pymysql.connect(
        host=cfg["host"],
        port=cfg["port"],
        db=cfg["db"],
        user=cfg["user"],
        password=cfg["password"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def get_companies(env: str, country: str = None, kyc_status: str = "APPROVED"):
    conn = _conn(env)
    try:
        with conn.cursor() as cur:
            sql = """
                SELECT c.company_id, c.name, ac.country,
                       c.kyc_stage_1, c.kyc_stage_2, c.compliance_status
                FROM company c
                LEFT JOIN address_country ac ON c.company_address_country = ac.address_id
                WHERE c.kyc_stage_1 = %s
            """
            params = [kyc_status]
            if country:
                sql += " AND LOWER(COALESCE(ac.country, '')) LIKE LOWER(%s)"
                params.append(f"%{country}%")
            sql += " ORDER BY c.name LIMIT 100"
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()


def get_users(env: str, company_id: int, status: str = "ACTIVE"):
    conn = _conn(env)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.user_id, u.email, u.name, u.last_name,
                       u.status, u.is_legal_representative
                FROM user u
                WHERE u.company_id = %s AND u.status = %s
                ORDER BY u.is_legal_representative DESC
                LIMIT 20
                """,
                (company_id, status),
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_countries(env: str):
    conn = _conn(env)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ac.country
                FROM company c
                JOIN address_country ac ON c.company_address_country = ac.address_id
                WHERE c.kyc_stage_1 = 'APPROVED' AND ac.country IS NOT NULL
                ORDER BY ac.country
                """
            )
            return [r["country"] for r in cur.fetchall()]
    finally:
        conn.close()


def get_user_status(env: str, email: str):
    conn = _conn(env)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.user_id, u.email, u.name, u.last_name,
                    u.status AS user_status,
                    u.kyc_stage_1 AS user_kyc_stage_1,
                    u.is_legal_representative, u.verified_phone,
                    c.company_id, c.name AS company_name,
                    c.identification_type, c.identification_number,
                    c.kyc_stage_1 AS company_kyc_stage_1,
                    c.kyc_stage_2 AS company_kyc_stage_2,
                    c.kyc_stage_3 AS company_kyc_stage_3,
                    c.compliance_status,
                    ac.country, ac.state, ac.city
                FROM user u
                JOIN company c ON u.company_id = c.company_id
                LEFT JOIN address_country ac ON c.company_address_country = ac.address_id
                WHERE u.email = %s
                LIMIT 1
                """,
                (email,),
            )
            row = cur.fetchone()
            if not row:
                return None

            cur.execute(
                """
                SELECT user_id, email, name, last_name, status, is_legal_representative
                FROM user WHERE company_id = %s ORDER BY is_legal_representative DESC
                """,
                (row["company_id"],),
            )
            row["company_users"] = cur.fetchall()
            return row
    finally:
        conn.close()


def find_user_by_email(env: str, email: str):
    conn = _conn(env)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.user_id, u.email, u.name, u.last_name, u.status,
                       c.company_id, c.name AS company_name,
                       c.kyc_stage_1, c.kyc_stage_2, c.compliance_status,
                       ac.country
                FROM user u
                JOIN company c ON u.company_id = c.company_id
                LEFT JOIN address_country ac ON c.company_address_country = ac.address_id
                WHERE u.email = %s
                LIMIT 1
                """,
                (email,),
            )
            return cur.fetchone()
    finally:
        conn.close()


def get_company_full(env: str, company_id: int):
    conn = _conn(env)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.company_id, c.name, c.identification_type, c.identification_number,
                       c.kyc_stage_1, c.kyc_stage_2, c.kyc_stage_3, c.compliance_status,
                       ac.country, ac.state, ac.city
                FROM company c
                LEFT JOIN address_country ac ON c.company_address_country = ac.address_id
                WHERE c.company_id = %s
                """,
                (company_id,),
            )
            company = cur.fetchone()

            cur.execute(
                """
                SELECT user_id, email, name, last_name, status, is_legal_representative
                FROM user
                WHERE company_id = %s
                ORDER BY is_legal_representative DESC
                """,
                (company_id,),
            )
            users = cur.fetchall()
            return {"company": company, "users": users}
    finally:
        conn.close()
