import base64
import hashlib
import hmac

import boto3
from botocore.exceptions import ClientError

from config import CONFIGS, DEFAULT_PASSWORD


def _secret_hash(username: str, client_id: str, client_secret: str) -> str:
    msg = (username + client_id).encode("utf-8")
    key = client_secret.encode("utf-8")
    return base64.b64encode(hmac.new(key, msg, hashlib.sha256).digest()).decode()


def login_cognito(env: str, email: str, password: str = None) -> dict:
    cfg = CONFIGS[env]["cognito"]
    client = boto3.client("cognito-idp", region_name=cfg["region"])

    auth_params = {
        "USERNAME": email,
        "PASSWORD": password or DEFAULT_PASSWORD,
        "SECRET_HASH": _secret_hash(email, cfg["client_id"], cfg["client_secret"]),
    }

    try:
        resp = client.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters=auth_params,
            ClientId=cfg["client_id"],
        )
    except ClientError as exc:
        raise RuntimeError(exc.response["Error"]["Message"]) from exc

    result = resp.get("AuthenticationResult", {})
    challenge = resp.get("ChallengeName")

    return {
        "accessToken": result.get("AccessToken"),
        "idToken": result.get("IdToken"),
        "refreshToken": result.get("RefreshToken"),
        "tokenType": result.get("TokenType"),
        "expiresIn": result.get("ExpiresIn"),
        "nextStep": challenge,
    }


def reset_password(env: str, email: str, new_password: str = None) -> None:
    cfg = CONFIGS[env]["cognito"]
    client = boto3.client("cognito-idp", region_name=cfg["region"])
    try:
        client.admin_set_user_password(
            UserPoolId=cfg["user_pool_id"],
            Username=email,
            Password=new_password or DEFAULT_PASSWORD,
            Permanent=True,
        )
    except ClientError as exc:
        raise RuntimeError(exc.response["Error"]["Message"]) from exc
