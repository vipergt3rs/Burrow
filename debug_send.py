import socket
import time

def debug_sender():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    
    magic_word = b"DISCOVER_LOCAL_SHARE"
    
    print("[SENDER] Starting simulated phone broadcast...")
    
    while True:
        print("[SENDER] Shouting to 255.255.255.255:8888...")
        try:
            sock.sendto(magic_word, ("255.255.255.255", 8888))
        except Exception as e:
            print(f"[SENDER] Failed to send: {e}")
        
        time.sleep(2)

if __name__ == "__main__":
    debug_sender()