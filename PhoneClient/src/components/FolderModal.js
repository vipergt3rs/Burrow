import React from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Checkbox from 'expo-checkbox';

import { theme } from '../theme/theme';
import { styles } from '../theme/styles';

export default function FolderModal({
  folderOffer,
  folderSelections,
  toggleFileSelection,
  onCancel,
  onDownload
}) {
  if (!folderOffer) return null;

  return (
    <Modal animationType="slide" transparent={false} visible={true}>
      <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
        <Text style={[styles.modalTitle, { color: theme.text }]}>Incoming Folder</Text>
        <Text style={[styles.modalSubtitle, { color: theme.subtext }]}>{folderOffer.folder_name}</Text>

        <ScrollView style={styles.visualizerList}>
          {folderOffer.files.map((file, idx) => (
            <TouchableOpacity key={idx} style={[styles.visualizerRow, { backgroundColor: theme.card }]} onPress={() => toggleFileSelection(file.token)}>
              <Checkbox
                style={styles.checkbox}
                value={folderSelections[file.token]}
                onValueChange={() => toggleFileSelection(file.token)}
                color={folderSelections[file.token] ? theme.primary : undefined}
              />
              <View style={styles.visualizerFileDetails}>
                <Text style={[styles.visualizerFileName, { color: theme.text }]}>{file.rel_path}</Text>
                <Text style={[styles.visualizerFileSize, { color: theme.subtext }]}>{(file.size / 1024).toFixed(1)} KB</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.modalButtons}>
          <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.danger }]} onPress={onCancel}>
            <Text style={styles.modalBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.primary }]} onPress={onDownload}>
            <Text style={styles.modalBtnText}>Download</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}