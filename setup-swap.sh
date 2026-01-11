#!/bin/bash
set -e

echo "Checking for existing swap..."
if free | awk '/^Swap:/ {exit !$2}'; then
    echo "Swap already exists."
else
    echo "Creating 2GB swap file..."
    # dynamic allocation is safer on some systems than fallocate
    dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Swap created successfully."
fi

# Tuning swap settings to prevent aggressive swapping
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
echo "Swap settings tuned."

echo "Current Memory Status:"
free -h
