# DockerSandboxProvider Notes

## Build the sandbox images

```bash
# TypeScript sandbox
docker build -t tacv-sandbox:latest \
  -f docker/sandbox/Dockerfile.sandbox \
  docker/sandbox/

# Java sandbox
docker build -t tacv-java-sandbox:latest \
  -f docker/sandbox/Dockerfile.java-sandbox \
  docker/sandbox/
```

## Install gVisor (optional but recommended for production)

```bash
# Ubuntu/Debian
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
sudo apt-get update && sudo apt-get install -y runsc

# Register with Docker (requires Docker daemon restart)
sudo runsc install
sudo systemctl restart docker
```

## Without gVisor (development mode)

Set `runtime: 'runc'` in `DockerSandboxConfig`, or use `runtime: 'auto'` (default)
which probes for gVisor and falls back to runc automatically.

## overlayfs note

overlayfs requires the worker to run as root, or to have `CAP_SYS_ADMIN`.
When overlayfs is unavailable, the provider falls back to a plain `fs.cp()` of
the repository into a temporary directory — still isolated, but slower on large repos.
