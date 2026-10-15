/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemFileHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showOpenFilePicker(options?: {
    multiple?: boolean;
    types?: FilePickerAcceptType[];
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }): Promise<FileSystemFileHandle>;
}
