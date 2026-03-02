import socket
import json
import platform
import threading
import asyncio
import os
import shutil
import uuid
import shlex
import urllib.parse
import sys

# Import winreg only if we are on Windows
if platform.system() == "Windows":
    import winreg

from tqdm import tqdm
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.responses import FileResponse
import uvicorn

# --- NETWORK CONFIG ---
UDP_IP = "0.0.0.0"
UDP_PORT = 8888
TCP_PORT = 8000
MAGIC_WORD = b"DISCOVER_LOCAL_SHARE"

# --- GLOBAL STATE ---
app = FastAPI()
active_ws = None
ws_loop = None
offered_files = {}
pending_action = None
RECEIVE_DIR = ""

def start_udp_listener():
    print(f"[DISCOVERY] Starting UDP listener on {UDP_IP}:{UDP_PORT}...")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.bind((UDP_IP, UDP_PORT))
        print(f"[DISCOVERY] Listening for Android broadcasts on UDP port {UDP_PORT}")

        while True:
            try:
                data, addr = sock.recvfrom(1024)
                if data == MAGIC_WORD:
                    print(f"\n[DISCOVERY] Broadcast received from {addr[0]}:{addr[1]}. Sending replies...")

                    response_dict = {"hostname": platform.node(), "tcp_port": TCP_PORT}
                    response = json.dumps(response_dict).encode("utf-8")

                    # Direct unicast reply
                    sock.sendto(response, addr)

                    # Network-wide broadcast reply (bypasses Windows routing issues)
                    try:
                        sock.sendto(response, ("255.255.255.255", addr[1]))
                    except Exception:
                        pass

                    print(f"[DISCOVERY] Replies sent to {addr[0]}.")
                    print("Burrow> ", end="", flush=True)
            except Exception:
                pass
    except Exception:
        pass


@app.get("/files")
def list_files():
    share_dir = "./shared"
    os.makedirs(share_dir, exist_ok=True)
    return [
        {"name": f, "size": os.path.getsize(os.path.join(share_dir, f))}
        for f in os.listdir(share_dir)
        if os.path.isfile(os.path.join(share_dir, f))
    ]


@app.get("/download/{filename}")
def download_shared(filename: str):
    path = os.path.join("./shared", filename)
    if os.path.exists(path):
        return FileResponse(path=path, filename=filename)
    return {"error": "Not found"}


@app.get("/download_token/{token}")
def download_token(token: str):
    if token in offered_files:
        filepath = offered_files.pop(token)
        return FileResponse(path=filepath, filename=os.path.basename(filepath))
    return {"error": "Invalid or expired token"}


@app.post("/upload")
async def receive_upload(request: Request, file: UploadFile = File(...)):
    # 1. Grab the real filename from our custom header
    encoded_name = request.headers.get('X-Real-Filename')
    if encoded_name:
        real_filename = urllib.parse.unquote(encoded_name)
    else:
        real_filename = file.filename or "uploaded_file.dat"

    dest_path = os.path.join(RECEIVE_DIR, real_filename)
    
    # 2. Setup the visual terminal progress bar
    total_size = int(request.headers.get('Content-Length', 0))
    print(f"\n[*] Receiving: {real_filename}")
    progress = tqdm(total=total_size, unit='B', unit_scale=True, desc="Downloading")
    
    with open(dest_path, "wb") as buffer:
        while True:
            chunk = await file.read(8192) # Read in 8KB chunks
            if not chunk:
                break
            buffer.write(chunk)
            progress.update(len(chunk))
            
    progress.close()
    print(f"\n[+] Successfully saved {real_filename}\nBurrow> ", end="", flush=True)
    return {"status": "success"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global active_ws, ws_loop, pending_action
    await websocket.accept()
    active_ws = websocket
    ws_loop = asyncio.get_running_loop()

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "PAIR_REQ":
                pending_action = "PAIR"
                print(f"\n[!] Connection request from: {msg.get('device')}. Accept? (y/n)\nBurrow> ", end="", flush=True)
            elif msg.get("type") == "UPLOAD_OFFER":
                pending_action = "UPLOAD"
                count = msg.get("count", 0)
                size_mb = msg.get("size", 0) / (1024 * 1024)
                files = msg.get("files", [])

                if files:
                    file_name = files[0].get("name", "Unknown")
                    if count > 1:
                        print(f"\n[!] Phone wants to send {count} files ({size_mb:.1f} MB). First file: {file_name}")
                    else:
                        print(f"\n[!] Phone wants to send file: '{file_name}' ({size_mb:.1f} MB)")
                else:
                    print(f"\n[!] Phone wants to send {count} file(s) ({size_mb:.1f} MB).")

                print("Accept? (y/n)\nBurrow> ", end="", flush=True)
                
            elif msg.get("type") == "PUSH_ACCEPT":
                print(f"\n[+] Phone accepted. Transferring...\nBurrow> ", end="", flush=True)
            elif msg.get("type") == "PUSH_REJECT":
                print(f"\n[-] Phone rejected the transfer.\nBurrow> ", end="", flush=True)

    except WebSocketDisconnect:
        active_ws = None
        print("\n[SYSTEM] Phone disconnected.\nBurrow> ", end="", flush=True)


def run_cli():
    global pending_action
    print("Commands: push <file>, add <folder>, y (accept), n (reject)\n")

    while True:
        try:
            cmd = input("Burrow> ").strip()
            if not cmd:
                continue

            parts = shlex.split(cmd, posix=False)
            action = parts[0].lower()

            if action == "y" and pending_action:
                if pending_action == "PAIR":
                    asyncio.run_coroutine_threadsafe(
                        active_ws.send_text(json.dumps({"type": "PAIR_ACCEPT"})), ws_loop
                    )
                    print("[+] Paired successfully.")
                elif pending_action == "UPLOAD":
                    asyncio.run_coroutine_threadsafe(
                        active_ws.send_text(json.dumps({"type": "UPLOAD_ACCEPT"})), ws_loop
                    )
                pending_action = None

            elif action == "n" and pending_action:
                if pending_action == "PAIR":
                    asyncio.run_coroutine_threadsafe(
                        active_ws.send_text(json.dumps({"type": "PAIR_REJECT"})), ws_loop
                    )
                elif pending_action == "UPLOAD":
                    asyncio.run_coroutine_threadsafe(
                        active_ws.send_text(json.dumps({"type": "UPLOAD_REJECT"})), ws_loop
                    )
                pending_action = None

            elif action == "push":
                if not active_ws:
                    print("[-] No phone connected.")
                    continue

                raw_push = cmd[5:].strip()
                if raw_push.startswith("&"):
                    raw_push = raw_push[1:].strip()

                if not raw_push:
                    print("[-] Usage: push <filepath>")
                    continue

                try:
                    split_parts = shlex.split(raw_push)
                except ValueError:
                    split_parts = [raw_push]

                cleaned = []
                for p in split_parts:
                    p = p.strip()
                    if p.startswith("&"):
                        p = p[1:].strip()
                    p = p.strip('"').strip("'").strip("\u2018").strip("\u2019")
                    if p:
                        cleaned.append(p)

                filepaths = cleaned if cleaned else [raw_push.strip('"').strip("'")]
                valid_files = [p for p in filepaths if os.path.exists(p) and os.path.isfile(p)]

                if not valid_files and len(filepaths) > 1:
                    single = raw_push.strip('"').strip("'").strip("\u2018").strip("\u2019")
                    if os.path.isfile(single):
                        valid_files = [single]

                if not valid_files:
                    print("[-] No valid files found.")
                    continue

                offer_payload = {"type": "PUSH_OFFER_MULTI", "files": []}
                for path in valid_files:
                    token = str(uuid.uuid4())
                    offered_files[token] = path
                    offer_payload["files"].append({
                        "filename": os.path.basename(path),
                        "size": os.path.getsize(path),
                        "token": token,
                    })

                offer_payload["total_size"] = sum(f["size"] for f in offer_payload["files"])
                asyncio.run_coroutine_threadsafe(
                    active_ws.send_text(json.dumps(offer_payload)), ws_loop
                )
                print(f"[*] Offered {len(valid_files)} file(s). Waiting for phone response...")

            elif cmd.lower().startswith("add "):
                if not active_ws:
                    print("[-] No phone connected.")
                    continue

                raw_add = cmd[4:].strip()

                if raw_add.startswith("&"):
                    raw_add = raw_add[1:].strip()

                folder_path = raw_add.strip('"').strip("'").strip("\u2018").strip("\u2019")

                if not folder_path:
                    print("[-] Usage: add <folderpath>")
                    continue

                if not os.path.isdir(folder_path):
                    print(f"[-] Not a valid folder: {folder_path}")
                    continue

                folder_name = os.path.basename(os.path.normpath(folder_path))
                print(f"[*] Scanning folder '{folder_name}'...")

                offer_payload = {"type": "FOLDER_OFFER", "folder_name": folder_name, "files": []}
                total_size = 0

                for root, dirs, files in os.walk(folder_path):
                    for file in files:
                        abs_path = os.path.join(root, file)
                        rel_path = os.path.relpath(abs_path, folder_path)
                        size = os.path.getsize(abs_path)
                        total_size += size

                        token = str(uuid.uuid4())
                        offered_files[token] = abs_path

                        offer_payload["files"].append({
                            "rel_path": rel_path,
                            "size": size,
                            "token": token,
                        })

                offer_payload["total_size"] = total_size
                asyncio.run_coroutine_threadsafe(
                    active_ws.send_text(json.dumps(offer_payload)), ws_loop
                )
                print(
                    f"[*] Sent manifest for '{folder_name}' "
                    f"({len(offer_payload['files'])} files, {total_size / 1024 / 1024:.1f} MB). "
                    f"Waiting for user selection..."
                )

            else:
                if pending_action:
                    print("[-] Pending request awaiting response. Type 'y' or 'n'.")
                else:
                    print("[-] Unknown command.")

        except KeyboardInterrupt:
            os._exit(0)


if __name__ == "__main__":
    print("\n" + "=" * 40)
    print("      Burrow - Local file sharing")
    print("=" * 40 + "\n")

    # --- AUTO-ASK FOR PATH INSTALLATION ---
    if platform.system() == "Windows":
        exe_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_ALL_ACCESS)
            current_path, _ = winreg.QueryValueEx(key, "Path")
            
            if exe_dir.lower() not in current_path.lower():
                print(f"[?] Burrow is not in your global PATH.")
                choice = input(f"    Add '{exe_dir}' to PATH so you can run 'burrow' from anywhere? (y/n): ").strip().lower()
                if choice == 'y':
                    new_path = current_path + os.pathsep + exe_dir
                    winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_path)
                    print("[+] SUCCESS: Added to PATH! (Restart your terminal for it to take effect)\n")
                else:
                    print("[-] Skipped adding to PATH.\n")
            winreg.CloseKey(key)
        except Exception:
            pass

    user_dir = input(
        "Where should received files be saved?\n"
        "(Press Enter to use the current folder): "
    ).strip()

    RECEIVE_DIR = user_dir.strip('"').strip("'") if user_dir else os.getcwd()
    os.makedirs(RECEIVE_DIR, exist_ok=True)
    
    try:
        _s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        _s.connect(("8.8.8.8", 80))
        local_ip = _s.getsockname()[0]
        _s.close()
    except Exception:
        local_ip = "unavailable"

    print(f"\n[+] Server address  : {local_ip}:{TCP_PORT}")
    print(f"[+] TCP address     : {local_ip}")
    print(f"[+] Saving files to : {RECEIVE_DIR}\n")

    threading.Thread(target=start_udp_listener, daemon=True).start()
    threading.Thread(
        target=lambda: uvicorn.run(app, host="0.0.0.0", port=TCP_PORT, log_level="critical"),
        daemon=True,
    ).start()

    run_cli()