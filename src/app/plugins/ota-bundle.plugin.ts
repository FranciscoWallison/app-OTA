import { registerPlugin } from '@capacitor/core';

export interface ExtractZipOptions {
  zipPath: string;
  targetDir: string;
}

export interface ExtractZipResult {
  success: boolean;
  path: string;
  fileCount: number;
}

export interface ValidateBundleResult {
  valid: boolean;
  path: string;
}

export interface OtaBundlePlugin {
  extractZip(options: ExtractZipOptions): Promise<ExtractZipResult>;
  resetToDefault(): Promise<void>;
  validateBundle(options: { path: string }): Promise<ValidateBundleResult>;
}

const OtaBundle = registerPlugin<OtaBundlePlugin>('OtaBundle');

export default OtaBundle;
