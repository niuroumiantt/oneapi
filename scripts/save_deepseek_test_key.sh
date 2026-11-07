#!/usr/bin/env bash
set -euo pipefail

# Local test credential only. Never commit this file or send the key through chat.
key_dir="${HOME}/.local/share/oneapi"
key_file="${key_dir}/deepseek-test-key"
umask 077
mkdir -p "$key_dir"
chmod 700 "$key_dir"
if [[ -e "$key_file" || -L "$key_file" ]]; then
  printf '测试 Key 已存在；如需更换，请先手动删除 %s\n' "$key_file" >&2
  exit 1
fi
printf '请粘贴 DeepSeek 测试 API Key，按回车保存（输入不会显示）：' >&2
IFS= read -r -s key
printf '\n' >&2
if [[ -z "$key" || "$key" == *$'\n'* || "$key" == *$'\r'* ]]; then
  printf 'Key 为空或格式不正确，未保存。\n' >&2
  exit 1
fi
printf '%s' "$key" > "$key_file"
chmod 600 "$key_file"
unset key
printf '已保存至仅当前用户可读的本机测试文件：%s\n' "$key_file"
