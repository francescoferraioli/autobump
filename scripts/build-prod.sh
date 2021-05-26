#!/usr/bin/env bash

set -e
set -o nounset

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

sh "${SCRIPT_DIR}/build.sh" ""