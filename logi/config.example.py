CONFIGS = {
    "dev": {
        "company_db": {
            "host": "db-dev-wr.global66.com",
            "port": 3306,
            "db": "company",
            "user": "ms-company",
            "password": "YOUR_DEV_DB_PASSWORD",
        },
        "cognito": {
            "region": "us-east-1",
            "user_pool_id": "YOUR_DEV_USER_POOL_ID",
            "client_id": "YOUR_DEV_CLIENT_ID",
            "client_secret": "YOUR_DEV_CLIENT_SECRET",
        },
    },
    "ci": {
        "company_db": {
            "host": "db-ci-wr.global66.com",
            "port": 3306,
            "db": "company",
            "user": "ms-company",
            "password": "YOUR_CI_DB_PASSWORD",
        },
        "cognito": {
            "region": "us-east-1",
            "user_pool_id": "YOUR_CI_USER_POOL_ID",
            "client_id": "YOUR_CI_CLIENT_ID",
            "client_secret": "YOUR_CI_CLIENT_SECRET",
        },
    },
}

DEFAULT_PASSWORD = "Global66"
