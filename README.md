# 🐇 Burrow

**Burrow** is a hyper-fast, zero-friction local file transfer utility. It bypasses cloud uploads and heavy RAM limits to stream massive files and entire directories directly between your Android phone and Windows PC over your local Wi-Fi network.

## 🚀 Installation

### 1. Windows PC (The Server)
1. Go to the [Releases](https://github.com/vipergt3rs/Burrow/releases) tab and download the latest version.
2. Extract the folder to a permanent location on your PC.
3. Open the folder and double-click `burrow.exe`.
4. The app will detect it is not in your system PATH and ask: `Add to PATH? (y/n)`. Type `y` and press Enter.
5. **Restart your terminal.** You can now type `burrow` from anywhere to start the server!

### 2. Android (The Client)
1. Download `Burrow-Android-v1.0.apk` from the [Releases](https://github.com/vipergt3rs/Burrow/releases) tab.
2. Open the file on your phone and install it.
3. Grant the required storage permissions so Burrow can save files to your hard drive.

---

## 📖 How to Use

### Step 1: Pair the Devices
1. Open a terminal on your PC and type `burrow` to start the server.
2. Open the Burrow app on your phone and tap **Scan for PC**, if scanning dosen't work manually type the **TCP address** from the terminal window of Burrow in the pc.
3. Tap **Pair** next to your PC's name.
4. On your PC terminal, type `y` to accept the connection.

### Step 2: PC to Phone Transfers
* **Send a single file:** `Burrow> push "C:\Path\To\File.mp4"`
* **Send multiple files:** `Burrow> push "file1.png" "file2.wav"`
* **Send an entire folder:** `Burrow> add "C:\Path\To\Folder"`

### Step 3: Phone to PC Transfers
1. In the Android app, tap **Upload to PC**.
2. Select any file (or multiple files) from your phone.
3. On your PC terminal, type `y` to accept the transfer.
