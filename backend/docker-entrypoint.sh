#!/bin/bash
set -e

SSH_DIR="/home/claudeuser/.ssh"

# Ensure .ssh directory exists with correct permissions
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

# Setup SSH key from environment variable (base64 encoded)
echo "Setting up SSH keys..."
if [ -n "$SSH_PRIVATE_KEY" ]; then
    echo "$SSH_PRIVATE_KEY" | base64 -d > "$SSH_DIR/id_ed25519"
    chmod 600 "$SSH_DIR/id_ed25519"
    echo "  SSH key configured from environment variable"
else
    echo "  WARNING: SSH_PRIVATE_KEY not set, git clone with SSH URLs may fail"
fi

# Create SSH config for github.com
echo "Configuring SSH for github.com..."
cat > "$SSH_DIR/config" << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new

Host *
  StrictHostKeyChecking accept-new
EOF
chmod 600 "$SSH_DIR/config"

# Add github.com to known_hosts
echo "Adding github.com to known_hosts..."
ssh-keyscan -t ed25519,rsa github.com > "$SSH_DIR/known_hosts" 2>/dev/null || true
chmod 600 "$SSH_DIR/known_hosts"

echo "SSH setup complete."

# Verify SSH key if present
if [ -f "$SSH_DIR/id_ed25519" ]; then
    echo "SSH key fingerprint:"
    ssh-keygen -lf "$SSH_DIR/id_ed25519" 2>/dev/null || echo "  (unable to read fingerprint)"
fi

# Start the Node.js application
exec node dist/index.js
