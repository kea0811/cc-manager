#!/bin/bash
set -e

# Ensure SSH config has a default github.com entry if it doesn't exist
# Check more carefully to avoid overwriting user config
if [ -f /home/claudeuser/.ssh/config ]; then
    # Only add if there's no github.com entry at all (including with indentation)
    if ! grep -qE "^Host\s+github\.com(\s|$)" /home/claudeuser/.ssh/config 2>/dev/null; then
        echo "Adding default github.com SSH config..."

        # Find the best available SSH key for github
        # Prefer user-specific keys (pattern: *_id_*) over default id_*
        KEY_FILE=""

        # First, look for GitHub-specific keys (most specific)
        for key in /home/claudeuser/.ssh/*_id_ed25519 /home/claudeuser/.ssh/*_id_rsa; do
            if [ -f "$key" ]; then
                keyname=$(basename "$key")
                if [ "$keyname" != "id_ed25519" ] && [ "$keyname" != "id_rsa" ]; then
                    KEY_FILE="$key"
                    echo "Found user-specific key: $KEY_FILE"
                    break
                fi
            fi
        done

        # Fallback to default keys if no user-specific key found
        if [ -z "$KEY_FILE" ]; then
            for key in /home/claudeuser/.ssh/id_ed25519 /home/claudeuser/.ssh/id_rsa; do
                if [ -f "$key" ]; then
                    KEY_FILE="$key"
                    echo "Using default key: $KEY_FILE"
                    break
                fi
            done
        fi

        if [ -n "$KEY_FILE" ]; then
            echo -e "\nHost github.com\n  HostName github.com\n  User git\n  IdentityFile $KEY_FILE\n  StrictHostKeyChecking accept-new" >> /home/claudeuser/.ssh/config
            echo "Added github.com config using $KEY_FILE"
        fi
    else
        echo "github.com SSH config already exists, skipping..."
    fi
fi

# Ensure github.com is in known_hosts
if [ ! -f /home/claudeuser/.ssh/known_hosts ] || ! grep -q "github.com" /home/claudeuser/.ssh/known_hosts 2>/dev/null; then
    echo "Adding github.com to known_hosts..."
    ssh-keyscan github.com >> /home/claudeuser/.ssh/known_hosts 2>/dev/null || true
fi

# Start the Node.js application
exec node dist/index.js
