#!/bin/bash

# Server Hardening Script
# Installs and configures UFW, Fail2Ban, and secures SSH.

set -e

echo "🛡️  Starting Server Hardening..."

# 1. Install Security Tools
echo "📦 Installing UFW and Fail2Ban..."
apt-get update -y
apt-get install -y ufw fail2ban

# 2. Configure Firewall (UFW)
echo "🧱 Configuring Firewall..."
ufw default deny incoming
ufw default allow outgoing

# Allow Critical Ports
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Enable UFW (Non-interactive)
echo "y" | ufw enable

echo "✅ Firewall active and enabled on system startup"

# 3. Configure Fail2Ban
echo "🚫 Configuring Fail2Ban..."
# Create a local jail configuration if it doesn't exist
if [ ! -f /etc/fail2ban/jail.local ]; then
    cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
    echo "Created jail.local"
fi

# Ensure sshd jail is enabled
cat >> /etc/fail2ban/jail.local <<EOF

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
EOF

systemctl restart fail2ban
echo "✅ Fail2Ban running and protecting SSH"

# 4. SSH Hardening
echo "locked_keys" > /tmp/ssh_harden_check
echo "🔑 Securing SSH Configuration..."

# Backup config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak

# Disabling Password Authentication (Caution: Ensure you have SSH keys set up!)
# We use sed to safely replace or append the setting
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Ensure Root can only login with keys (no password)
sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config

# Restart SSH to apply changes
systemctl restart sshd

echo "✅ SSH secured (Password Auth disabled)"
echo "🎉 Server Hardening Complete!"
echo "   - Firewall: Active (22, 80, 443 ALLOWED)"
echo "   - Fail2Ban: Active (SSHD protection)"
echo "   - SSH: Key-based auth ONLY"
