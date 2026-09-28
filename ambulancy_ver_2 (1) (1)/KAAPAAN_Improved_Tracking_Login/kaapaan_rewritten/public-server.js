const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const projectDir = __dirname;
const publicUrlFile = path.join(projectDir, "public-url.json");

function cleanUrlFile() {
    try { fs.unlinkSync(publicUrlFile); } catch (_) {}
}

function commandExists(command) {
    return new Promise((resolve) => {
        const child = spawn(command, ["--version"], { shell: true, windowsHide: true });
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        child.on("error", () => finish(false));
        child.on("close", (code) => finish(code === 0));
        setTimeout(() => { try { child.kill(); } catch (_) {} ; finish(false); }, 3000);
    });
}

async function main() {
    cleanUrlFile();

    const cloudflaredAvailable = await commandExists("cloudflared");
    if (!cloudflaredAvailable) {
        console.error("\n❌ cloudflared was not found in PATH.");
        console.error("Install it from the official Cloudflare downloads page:");
        console.error("https://developers.cloudflare.com/tunnel/downloads/");
        console.error("Then reopen PowerShell and run: cloudflared --version\n");
        process.exit(1);
    }

    console.log("\n🚑 Starting KAAPAAN local server...\n");
    const server = spawn(process.execPath, [path.join(projectDir, "server.js")], {
        cwd: projectDir,
        stdio: "inherit",
        env: process.env,
        windowsHide: false
    });

    let tunnelStarted = false;
    const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], {
        cwd: projectDir,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false
    });

    const handleTunnelOutput = (chunk) => {
        const text = chunk.toString();
        process.stdout.write(`[CLOUDFLARE] ${text}`);
        const match = text.match(/https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/);
        if (match && !tunnelStarted) {
            tunnelStarted = true;
            const url = match[0].replace(/\/$/, "");
            fs.writeFileSync(publicUrlFile, JSON.stringify({ url, createdAt: new Date().toISOString() }, null, 2));
            console.log("\n============================================================");
            console.log("🌍 KAAPAAN PUBLIC MOBILE URL");
            console.log("============================================================");
            console.log(`📱 ${url}/index.html?mode=ambulance&room=AMB-SYNC`);
            console.log("============================================================");
            console.log("📌 Scan the QR from the Traffic Control dashboard.");
            console.log("📌 The phone can now use 4G/5G and travel outside the Wi-Fi range.");
            console.log("📌 Keep BOTH this terminal and the laptop connected to the Internet.");
            console.log("============================================================\n");
        }
    };

    tunnel.stdout.on("data", handleTunnelOutput);
    tunnel.stderr.on("data", handleTunnelOutput);

    const shutdown = () => {
        cleanUrlFile();
        try { tunnel.kill(); } catch (_) {}
        try { server.kill(); } catch (_) {}
    };

    process.on("SIGINT", () => { shutdown(); process.exit(0); });
    process.on("SIGTERM", () => { shutdown(); process.exit(0); });

    server.on("close", (code) => {
        try { tunnel.kill(); } catch (_) {}
        cleanUrlFile();
        process.exit(code || 0);
    });

    tunnel.on("close", () => {
        if (tunnelStarted) {
            console.log("\n⚠️ Cloudflare tunnel stopped. The remote phone can no longer reach KAAPAAN.");
            cleanUrlFile();
        }
    });
}

main().catch((err) => {
    console.error("❌ Public launcher error:", err);
    process.exit(1);
});
