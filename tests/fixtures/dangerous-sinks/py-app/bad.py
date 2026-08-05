import os
import subprocess
import pickle
import yaml
import requests

def run_user(cmd: str):
    os.system(f"ls {cmd}")
    subprocess.run(f"echo {cmd}", shell=True)


def safe_run():
    subprocess.run(["ls", "-la"], shell=False)


def leaky_sql(cur, user_id: str):
    cur.execute(f"SELECT * FROM users WHERE id = '{user_id}'")


def safe_sql(cur, user_id: str):
    cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))


def bad_tls():
    requests.get("https://example.com", verify=False)


def bad_deser(data: bytes):
    return pickle.loads(data)


def bad_yaml(raw: str):
    return yaml.load(raw)


def bad_eval(code: str):
    return eval(code)
