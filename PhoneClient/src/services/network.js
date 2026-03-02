import dgram from 'react-native-udp';
import * as FileSystem from 'expo-file-system/legacy';

const UDP_PORT = 8888;
const MAGIC_WORD = 'DISCOVER_LOCAL_SHARE';

export const scanForPCs = (setPcList, setStatus) => {
  setStatus('Scanning...');
  setPcList([]);
  const socket = dgram.createSocket('udp4');
  socket.bind(8889, '0.0.0.0');
  socket.once('listening', () => socket.send(MAGIC_WORD, undefined, undefined, UDP_PORT, '255.255.255.255'));

  socket.on('message', (msg, rinfo) => {
    try {
      const response = JSON.parse(msg.toString());
      setPcList(prev => {
        if (prev.some(pc => pc.ip === rinfo.address)) return prev;
        return [...prev, { hostname: response.hostname, ip: rinfo.address, port: response.tcp_port }];
      });
    } catch (e) { }
  });

  setTimeout(() => { try { socket.close(); } catch (e) { } setStatus('Scan finished.'); }, 4000);
};

export const uploadFilesToPc = async (activePc, files, setStatus) => {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setStatus(`Uploading ${i + 1}/${files.length}: ${file.name}`);

    await FileSystem.uploadAsync(`http://${activePc.ip}:${activePc.port}/upload`, file.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      // THE UPLOAD FIX: Force generic binary if Android doesn't recognize the file type
      mimeType: file.mimeType || 'application/octet-stream',
      headers: {
        'X-Real-Filename': encodeURIComponent(file.name)
      }
    });
  }
};