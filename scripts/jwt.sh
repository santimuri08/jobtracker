#!/bin/bash
# Usage: ./scripts/jwt.sh [039|636]
# Prints a JWT for the requested user, good for 1 hour.

case "$1" in
  636)
    USER_ID="cmp1ifhu50000x71fhrh0q02v"
    EMAIL="santimuri636@gmail.com"
    ;;
  039|"")
    USER_ID="cmoxsr1i90000t41fp9i48dmt"
    EMAIL="santimuri039@gmail.com"
    ;;
  *)
    echo "Usage: $0 [039|636]" >&2
    exit 1
    ;;
esac

docker compose exec -T backend python -c "
import time
from jose import jwt
from app.config import settings
print(jwt.encode(
    {'sub': '$USER_ID', 'email': '$EMAIL', 'iat': int(time.time()), 'exp': int(time.time()) + 3600},
    settings.jwt_secret,
    algorithm=settings.jwt_algorithm,
))
"
