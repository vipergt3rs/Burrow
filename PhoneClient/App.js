import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, StatusBar, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import ReactNativeBlobUtil from 'react-native-blob-util';

// UI & Components
import { theme } from './src/theme/theme';
import { styles } from './src/theme/styles';
import FolderModal from './src/components/FolderModal';

// Extracted Services
import { sanitizeName, requestStoragePermission, handleSyncError } from './src/services/storage';
import { scanForPCs, uploadFilesToPc } from './src/services/network';

// Helper to format ETA cleanly
const formatEta = (seconds) => {
  if (seconds === null || isNaN(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
};

export default function App() {
  const [pcList, setPcList] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [wsConnection, setWsConnection] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const [activePc, setActivePc] = useState(null);
  const activePcRef = useRef(null);
  const [pendingUploads, setPendingUploads] = useState([]);
  const pendingUploadsRef = useRef([]);

  const [folderOffer, setFolderOffer] = useState(null);
  const [folderSelections, setFolderSelections] = useState({});
  const [manualIp, setManualIp] = useState('');

  // Progress & ETA State
  const [folderProgress, setFolderProgress] = useState({ current: 0, total: 0 });
  const [transferSpeed, setTransferSpeed] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [etaSeconds, setEtaSeconds] = useState(null);

  const updateActivePc = (pc) => { setActivePc(pc); activePcRef.current = pc; };
  const updatePendingUploads = (files) => { setPendingUploads(files); pendingUploadsRef.current = files; };

  const connectToPc = (pc) => {
    setStatus(`Connecting...`);
    const ws = new WebSocket(`ws://${pc.ip}:${pc.port}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'PAIR_REQ', device: 'Android Phone' }));

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'PAIR_ACCEPT') { setStatus('Paired'); updateActivePc(pc); setWsConnection(ws); }
      else if (msg.type === 'FOLDER_OFFER') {
        const initialSelections = {};
        msg.files.forEach(f => { initialSelections[f.token] = true; });
        setFolderSelections(initialSelections);
        setFolderOffer(msg);
      }
      else if (msg.type === 'PUSH_OFFER_MULTI') {
        let alertMessage = "";
        if (msg.files.length === 1) {
          const sizeMb = (msg.files[0].size / (1024 * 1024)).toFixed(2);
          alertMessage = `File: ${msg.files[0].filename}\nSize: ${sizeMb} MB`;
        } else {
          const totalMb = (msg.files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2);
          alertMessage = `${msg.files.length} files (${totalMb} MB)\nIncluding: ${msg.files[0].filename}...`;
        }

        Alert.alert("Incoming File(s)", alertMessage, [
          { text: "Reject", onPress: () => ws.send(JSON.stringify({ type: 'PUSH_REJECT' })), style: "cancel" },
          {
            text: "Accept", onPress: () => {
              ws.send(JSON.stringify({ type: 'PUSH_ACCEPT' }));
              processMultiFileDownload(msg.files);
            }
          }
        ]);
      }
      else if (msg.type === 'UPLOAD_ACCEPT') { await handleUpload(); }
    };
    ws.onclose = () => { updateActivePc(null); setWsConnection(null); setStatus('Disconnected.'); };
  };

  const toggleFileSelection = (token) => {
    setFolderSelections(prev => ({ ...prev, [token]: !prev[token] }));
  };

  // --- NATIVE MEDIA STORE STREAMING (push <file>) ---
  const processMultiFileDownload = async (filesToDownload) => {
    const hasPerm = await requestStoragePermission();
    if (!hasPerm) { setStatus("Permission Denied."); return; }

    setIsDownloading(true);
    setEtaSeconds(null);
    try {
      const BATCH_SIZE = 2;
      let completed = 0;
      let downloadedBytes = 0;
      const totalBytes = filesToDownload.reduce((acc, f) => acc + f.size, 0);

      for (let i = 0; i < filesToDownload.length; i += BATCH_SIZE) {
        const batch = filesToDownload.slice(i, i + BATCH_SIZE);
        const startTime = Date.now();

        setCurrentFileName(batch.length === 1 ? batch[0].filename : `${batch[0].filename} & ${batch.length - 1} more`);

        await Promise.all(batch.map(async (file) => {
          const safeFileName = sanitizeName(file.filename);
          const downloadUrl = `http://${activePcRef.current.ip}:${activePcRef.current.port}/download_token/${file.token}`;
          const tempCachePath = ReactNativeBlobUtil.fs.dirs.CacheDir + `/temp_${file.token}`;

          await ReactNativeBlobUtil.config({ path: tempCachePath }).fetch('GET', downloadUrl);

          // THE DOWNLOAD FIX: 'application/octet-stream' guarantees Android writes it regardless of format
          await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
            { name: safeFileName, parentFolder: 'Burrow', mimeType: 'application/octet-stream' },
            'Download',
            tempCachePath
          );
          await ReactNativeBlobUtil.fs.unlink(tempCachePath);
        }));

        completed += batch.length;
        setFolderProgress({ current: completed, total: filesToDownload.length });

        const duration = (Date.now() - startTime) / 1000;
        const batchBytes = batch.reduce((acc, f) => acc + f.size, 0);
        downloadedBytes += batchBytes;

        const speedMbPerSec = duration > 0 ? (batchBytes / (1024 * 1024)) / duration : 0;
        setTransferSpeed(speedMbPerSec.toFixed(2));

        if (speedMbPerSec > 0) {
          const remainingMb = (totalBytes - downloadedBytes) / (1024 * 1024);
          setEtaSeconds(remainingMb / speedMbPerSec);
        }
      }
      setStatus('Files Saved');
      Alert.alert("Success", "Files saved to Downloads/Burrow.");
    } catch (e) { handleSyncError(e, setStatus); }
    finally { setIsDownloading(false); setTransferSpeed(0); setCurrentFileName(''); }
  };

  // --- NATIVE MEDIA STORE STREAMING (add <folder>) ---
  const processFolderDownload = async () => {
    const filesToDownload = folderOffer.files.filter(f => folderSelections[f.token]);
    if (filesToDownload.length === 0) {
      wsConnection.send(JSON.stringify({ type: 'PUSH_REJECT' }));
      setFolderOffer(null); return;
    }

    const hasPerm = await requestStoragePermission();
    if (!hasPerm) { setStatus("Permission Denied."); return; }

    const safeBaseFolderName = sanitizeName(folderOffer.folder_name);

    wsConnection.send(JSON.stringify({ type: 'PUSH_ACCEPT' }));
    setFolderOffer(null);
    setIsDownloading(true);
    setEtaSeconds(null);

    try {
      setStatus('Syncing...');
      const BATCH_SIZE = 2;
      let completed = 0;
      let downloadedBytes = 0;
      const totalBytes = filesToDownload.reduce((acc, f) => acc + f.size, 0);

      for (let i = 0; i < filesToDownload.length; i += BATCH_SIZE) {
        const batch = filesToDownload.slice(i, i + BATCH_SIZE);
        const startTime = Date.now();

        const firstFileInBatchParts = batch[0].rel_path.split(/[\\\/]/);
        setCurrentFileName(firstFileInBatchParts.pop() || "File");

        await Promise.all(batch.map(async (file) => {
          const pathParts = file.rel_path.split(/[\\\/]/);
          const safeFileName = sanitizeName(pathParts.pop());

          const subFolderPath = pathParts.map(p => sanitizeName(p)).join('/');
          const parentFolder = subFolderPath
            ? `Burrow/${safeBaseFolderName}/${subFolderPath}`
            : `Burrow/${safeBaseFolderName}`;

          const downloadUrl = `http://${activePcRef.current.ip}:${activePcRef.current.port}/download_token/${file.token}`;
          const tempCachePath = ReactNativeBlobUtil.fs.dirs.CacheDir + `/temp_${file.token}`;

          await ReactNativeBlobUtil.config({ path: tempCachePath }).fetch('GET', downloadUrl);

          // THE DOWNLOAD FIX: 'application/octet-stream' guarantees Android writes it regardless of format
          await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
            { name: safeFileName, parentFolder: parentFolder, mimeType: 'application/octet-stream' },
            'Download',
            tempCachePath
          );

          await ReactNativeBlobUtil.fs.unlink(tempCachePath);
        }));

        completed += batch.length;
        setFolderProgress({ current: completed, total: filesToDownload.length });

        const duration = (Date.now() - startTime) / 1000;
        const batchBytes = batch.reduce((acc, f) => acc + f.size, 0);
        downloadedBytes += batchBytes;

        const speedMbPerSec = duration > 0 ? (batchBytes / (1024 * 1024)) / duration : 0;
        setTransferSpeed(speedMbPerSec.toFixed(2));

        if (speedMbPerSec > 0) {
          const remainingMb = (totalBytes - downloadedBytes) / (1024 * 1024);
          setEtaSeconds(remainingMb / speedMbPerSec);
        }
      }

      setStatus('All Synced');
      Alert.alert("Success", "Folder downloaded to Downloads/Burrow");
    } catch (e) { handleSyncError(e, setStatus); }
    finally { setIsDownloading(false); setTransferSpeed(0); setCurrentFileName(''); }
  };

  const handleUpload = async () => {
    setIsDownloading(true);
    try {
      await uploadFilesToPc(activePcRef.current, pendingUploadsRef.current, setStatus);
      setStatus('Upload Complete');
    } catch (e) { setStatus('Upload Failed'); }
    finally { setIsDownloading(false); updatePendingUploads([]); }
  };

  const pickFilesAndOffer = async () => {
    // THE PICKER FIX: Force picker to allow strictly ANY file format
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, type: '*/*' });
    if (!result.canceled && result.assets.length > 0) {
      updatePendingUploads(result.assets);
      const totalSize = result.assets.reduce((s, f) => s + f.size, 0);

      const fileData = result.assets.map(f => ({ name: f.name, size: f.size }));

      wsConnection.send(JSON.stringify({
        type: 'UPLOAD_OFFER',
        count: result.assets.length,
        size: totalSize,
        files: fileData
      }));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={theme.statusBar} backgroundColor={theme.background} />
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Burrow</Text>
      </View>

      <FolderModal
        folderOffer={folderOffer}
        folderSelections={folderSelections}
        toggleFileSelection={toggleFileSelection}
        onCancel={() => { wsConnection.send(JSON.stringify({ type: 'PUSH_REJECT' })); setFolderOffer(null); }}
        onDownload={processFolderDownload}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {!activePc ? (
          <View style={styles.connectContainer}>
            <Text style={[styles.statusText, { color: theme.subtext, marginVertical: 20 }]}>{status}</Text>
            <TouchableOpacity style={[styles.scanBtn, { backgroundColor: theme.primary }]} onPress={() => scanForPCs(setPcList, setStatus)}>
              <Text style={styles.scanBtnText}>Scan for PC</Text>
            </TouchableOpacity>

            <View style={styles.manualInputRow}>
              <TextInput style={[styles.ipInput, { color: theme.text, backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1 }]} placeholder="Manual IP" placeholderTextColor={theme.subtext} value={manualIp} onChangeText={setManualIp} />
              <TouchableOpacity style={[styles.connectBtn, { backgroundColor: theme.primary }]} onPress={() => connectToPc({ hostname: "PC", ip: manualIp.trim(), port: 8000 })}>
                <Text style={styles.connectBtnText}>Connect</Text>
              </TouchableOpacity>
            </View>

            {pcList.map((pc, i) => (
              <TouchableOpacity key={i} style={[styles.pcBox, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]} onPress={() => connectToPc(pc)}>
                <View><Text style={[styles.pcName, { color: theme.text }]}>{pc.hostname}</Text><Text style={[styles.pcIp, { color: theme.subtext }]}>{pc.ip}</Text></View>
                <Text style={{ color: theme.primary, fontWeight: 'bold' }}>Pair</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.fileArea}>
            <Text style={[styles.statusText, { color: theme.text, marginBottom: 20 }]}>{status}</Text>

            {isDownloading && (
              <View style={[styles.progressCard, { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }]}>

                <Text style={{ color: theme.text, fontSize: 13, marginBottom: 6 }} numberOfLines={1}>
                  Syncing: <Text style={{ fontWeight: 'bold' }}>{currentFileName}</Text>
                </Text>

                <View style={styles.progressHeader}>
                  <Text style={[styles.progressCount, { color: theme.text }]}>{folderProgress.current} / {folderProgress.total}</Text>
                  <Text style={[styles.progressSpeed, { color: theme.primary }]}>
                    {transferSpeed} MB/s {etaSeconds !== null ? ` • ETA: ${formatEta(etaSeconds)}` : ''}
                  </Text>
                </View>

                <View style={[styles.progressBarBg, { backgroundColor: theme.background }]}>
                  <View style={[styles.progressBarFill, { backgroundColor: theme.primary, width: `${(folderProgress.current / folderProgress.total) * 100}%` }]} />
                </View>
              </View>
            )}

            <TouchableOpacity style={[styles.uploadBtn, { backgroundColor: theme.primary }]} onPress={pickFilesAndOffer}>
              <Text style={styles.uploadBtnText}>Upload to PC</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => wsConnection.close()} style={{ marginTop: 30, alignItems: 'center' }}>
              <Text style={{ color: theme.danger }}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}