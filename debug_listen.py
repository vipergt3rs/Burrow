import socket

def debug_listener():

    hostname = socket.gethostname()
    ips = socket.gethostbyname_ex(hostname)[2]
    print(f"=== PC Network Interfaces ===")
    for ip in ips:
        print(f"- {ip}")
    print("=============================\n")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        sock.bind(("0.0.0.0", 8888))
        print("[LISTENER] Successfully bound to UDP 0.0.0.0:8888")
        print("[LISTENER] Waiting for broadcasts...")
    except Exception as e:
        print(f"[LISTENER] FAILED TO BIND: {e}")
        return

    while True:
        data, addr = sock.recvfrom(1024)
        print(f"\n[LISTENER] 🚨 INCOMING PACKET DETECTED! 🚨")
        print(f"[LISTENER] From IP: {addr[0]}:{addr[1]}")
        print(f"[LISTENER] Message: {data}")

if __name__ == "__main__":
    debug_listener()