import { Injectable } from '@angular/core';
import { Capacitor, WebView } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { environment } from '../../environments/environment';
import OtaBundle from '../plugins/ota-bundle.plugin';

// Types for OTA version response from server
interface VersionResponse {
  version: string;
  sha256: string;
  hmac: string;
  minVersion: string;
  forceUpdate: boolean;
  size: number;
  timestamp: string;
}

interface BundleMetadata {
  version: string;
  sha256: string;
  appliedAt: string;
  healthy: boolean;
}

interface OtaState {
  currentVersion: string;
  previousVersions: string[];
  lastCheckAt: string | null;
  consecutiveRollbacks: number;
}

interface StagedBundle {
  version: string;
  path: string;
}

// Storage keys
const KEYS = {
  OTA_STATE: 'ota_state',
  BUNDLE_PREFIX: 'bundle_meta_',
  HMAC_KEY: 'ota_hmac_key',
  ACTIVE_BUNDLE_PATH: 'ota_active_bundle_path',
  STAGED_VERSION: 'ota_staged_version',
} as const;

@Injectable({ providedIn: 'root' })
export class OtaManagerService {
  private state: OtaState = {
    currentVersion: '1.0.0',
    previousVersions: [],
    lastCheckAt: null,
    consecutiveRollbacks: 0,
  };

  private checking = false;
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null;

  async initialize(): Promise<void> {
    console.log('[OTA] Initializing OTA Manager...');

    await this.loadState();
    await this.ensureBundleDirectory();
    await this.ensureExtractDirectory();

    // Apply staged bundle if available (downloaded in previous session)
    await this.applyStagedBundleIfAvailable();

    // Verify active bundle path is still valid
    await this.verifyActiveBundlePath();

    this.startHealthCheck();

    // Check for updates in background when online
    const status = await Network.getStatus();
    if (status.connected) {
      this.checkForUpdateInBackground();
    }

    // Listen for network changes to check updates
    Network.addListener('networkStatusChange', (networkStatus) => {
      if (networkStatus.connected) {
        console.log('[OTA] Network restored, checking for updates...');
        this.checkForUpdateInBackground();
      }
    });

    console.log(`[OTA] Initialized. Current version: ${this.state.currentVersion}`);
  }

  /**
   * Verifica se ha nova versao disponivel no servidor
   */
  async checkForUpdate(): Promise<VersionResponse | null> {
    if (this.checking) {
      console.log('[OTA] Already checking for updates, skipping...');
      return null;
    }

    // Rate limit: no maximo a cada 5 minutos
    if (this.state.lastCheckAt) {
      const elapsed = Date.now() - new Date(this.state.lastCheckAt).getTime();
      if (elapsed < environment.versionCheckIntervalMs) {
        console.log('[OTA] Check interval not elapsed, skipping...');
        return null;
      }
    }

    this.checking = true;
    console.log('[OTA] Checking for updates...');

    try {
      const response = await fetch(`${environment.otaServerUrl}/api/version`, {
        method: 'GET',
        headers: { 'X-Current-Version': this.state.currentVersion },
      });

      if (!response.ok) {
        throw new Error(`[OTA] Server responded with ${response.status}`);
      }

      const versionData: VersionResponse = await response.json();
      this.state.lastCheckAt = new Date().toISOString();
      await this.saveState();

      // Verify HMAC of the response
      const isValid = await this.verifyHmac(versionData);
      if (!isValid) {
        console.error('[OTA] HMAC verification failed! Possible MITM attack.');
        return null;
      }

      // Anti-downgrade check
      if (this.compareVersions(versionData.version, this.state.currentVersion) <= 0) {
        console.log('[OTA] Already on latest version or newer.');
        return null;
      }

      // Check minVersion (forcar update pela Store se necessario)
      if (this.compareVersions(this.state.currentVersion, versionData.minVersion) < 0) {
        console.warn('[OTA] Current version below minimum. Force update may be required.');
      }

      console.log(`[OTA] New version available: ${versionData.version}`);
      return versionData;
    } catch (error) {
      console.error('[OTA] Error checking for updates:', error);
      return null;
    } finally {
      this.checking = false;
    }
  }

  /**
   * Baixa e armazena o bundle zip
   */
  async downloadBundle(versionData: VersionResponse): Promise<boolean> {
    console.log(`[OTA] Downloading bundle v${versionData.version}...`);

    let retries = 0;
    const maxRetries = environment.maxRetries;

    while (retries < maxRetries) {
      try {
        const response = await fetch(
          `${environment.otaServerUrl}/api/bundle/${versionData.version}`
        );

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        // Verify SHA-256 integrity
        const sha256 = await this.calculateSha256(arrayBuffer);
        if (sha256 !== versionData.sha256) {
          console.error(`[OTA] SHA-256 mismatch! Expected: ${versionData.sha256}, Got: ${sha256}`);
          return false;
        }

        console.log('[OTA] SHA-256 verified successfully.');

        // Save bundle to filesystem
        const base64Data = this.arrayBufferToBase64(arrayBuffer);
        const bundlePath = `ota-bundles/bundle-${versionData.version}.zip`;

        await Filesystem.writeFile({
          path: bundlePath,
          data: base64Data,
          directory: Directory.Data,
        });

        // Save bundle metadata
        const metadata: BundleMetadata = {
          version: versionData.version,
          sha256: versionData.sha256,
          appliedAt: '',
          healthy: false,
        };

        await Preferences.set({
          key: `${KEYS.BUNDLE_PREFIX}${versionData.version}`,
          value: JSON.stringify(metadata),
        });

        // Cleanup old bundles
        await this.cleanupOldBundles();

        console.log(`[OTA] Bundle v${versionData.version} downloaded and verified.`);
        return true;
      } catch (error) {
        retries++;
        const delay = Math.pow(2, retries) * 1000; // Exponential backoff
        console.error(`[OTA] Download attempt ${retries}/${maxRetries} failed:`, error);

        if (retries < maxRetries) {
          console.log(`[OTA] Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    console.error('[OTA] All download attempts failed.');
    return false;
  }

  /**
   * Extrai e prepara bundle para aplicar no proximo launch.
   * Melhor UX: nao interrompe o uso atual do app.
   */
  async stageBundle(version: string): Promise<boolean> {
    console.log(`[OTA] Staging bundle v${version} for next launch...`);

    try {
      // 1. Get absolute path of the downloaded zip
      const zipUri = await Filesystem.getUri({
        path: `ota-bundles/bundle-${version}.zip`,
        directory: Directory.Data,
      });
      const zipAbsolutePath = zipUri.uri.replace('file://', '');

      // 2. Prepare extraction target directory
      const extractDirPath = `ota-bundles/extracted/web-v${version}`;
      await this.ensureCleanDirectory(extractDirPath);

      const extractUri = await Filesystem.getUri({
        path: extractDirPath,
        directory: Directory.Data,
      });
      const extractAbsolutePath = extractUri.uri.replace('file://', '');

      // 3. Extract zip using native plugin
      console.log(`[OTA] Extracting bundle to ${extractAbsolutePath}...`);
      const result = await OtaBundle.extractZip({
        zipPath: zipAbsolutePath,
        targetDir: extractAbsolutePath,
      });

      if (!result.success) {
        console.error('[OTA] Zip extraction failed');
        return false;
      }
      console.log(`[OTA] Extracted ${result.fileCount} files`);

      // 4. Validate extracted bundle has index.html
      const validation = await OtaBundle.validateBundle({ path: extractAbsolutePath });
      if (!validation.valid) {
        console.error('[OTA] Extracted bundle is invalid (no index.html)');
        await this.cleanupExtractedDir(extractDirPath);
        return false;
      }

      // 5. Mark as staged (will apply on next launch)
      const staged: StagedBundle = { version, path: extractAbsolutePath };
      await Preferences.set({
        key: KEYS.STAGED_VERSION,
        value: JSON.stringify(staged),
      });

      console.log(`[OTA] Bundle v${version} staged. Will apply on next launch.`);
      return true;
    } catch (error) {
      console.error('[OTA] Error staging bundle:', error);
      return false;
    }
  }

  /**
   * Health check -- confirma que o app carregou corretamente
   * Chamado pelo AppComponent apos inicializacao bem-sucedida
   */
  confirmHealthy(): void {
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.state.consecutiveRollbacks = 0;
    this.saveState();

    console.log(`[OTA] Health check passed for v${this.state.currentVersion}`);
    this.reportStatus('healthy', this.state.currentVersion);
  }

  /**
   * Rollback para versao anterior com redirecionamento real do WebView
   */
  async rollback(): Promise<boolean> {
    console.log('[OTA] Initiating rollback...');

    this.state.consecutiveRollbacks++;

    // Se 3 rollbacks consecutivos ou sem versoes anteriores: voltar para baseline
    if (this.state.consecutiveRollbacks >= 3 || this.state.previousVersions.length === 0) {
      console.warn('[OTA] Reverting to baseline bundle (www/).');
      await this.resetToBaseline();
      return true;
    }

    const previousVersion = this.state.previousVersions.shift()!;
    this.state.currentVersion = previousVersion;
    await this.saveState();

    // Se rolling back para baseline
    if (previousVersion === '1.0.0') {
      await this.resetToBaseline();
      return true;
    }

    // Carregar o bundle anterior extraido
    try {
      const extractUri = await Filesystem.getUri({
        path: `ota-bundles/extracted/web-v${previousVersion}`,
        directory: Directory.Data,
      });
      const previousPath = extractUri.uri.replace('file://', '');

      const validation = await OtaBundle.validateBundle({ path: previousPath });
      if (!validation.valid) {
        console.error('[OTA] Previous bundle also invalid. Resetting to baseline.');
        await this.resetToBaseline();
        return true;
      }

      await Preferences.set({ key: KEYS.ACTIVE_BUNDLE_PATH, value: previousPath });
      await WebView.setServerBasePath({ path: previousPath });
      await WebView.persistServerBasePath();

      console.log(`[OTA] Rolled back to v${previousVersion}`);
      await this.reportStatus('rollback', previousVersion);
      return true;
    } catch (error) {
      console.error('[OTA] Rollback failed, resetting to baseline:', error);
      await this.resetToBaseline();
      return true;
    }
  }

  getCurrentVersion(): string {
    return this.state.currentVersion;
  }

  // ---- Public methods for the demo UI ----

  /**
   * Forca verificacao de update ignorando o rate limit.
   * Retorna true se um update foi encontrado, baixado e staged.
   */
  async forceCheckForUpdate(): Promise<boolean> {
    console.log('[OTA] Force checking for update (bypassing rate limit)...');
    this.state.lastCheckAt = null;
    await this.saveState();

    const versionData = await this.checkForUpdate();
    if (versionData) {
      const downloaded = await this.downloadBundle(versionData);
      if (downloaded) {
        const staged = await this.stageBundle(versionData.version);
        return staged;
      }
    }
    return false;
  }

  /**
   * Forca reset para o bundle baseline (www/ embutido no APK).
   * Expoe resetToBaseline() para uso na UI de demo.
   */
  async forceResetToBaseline(): Promise<void> {
    await this.resetToBaseline();
  }

  /**
   * Retorna uma copia do estado atual do OTA manager.
   */
  getState(): OtaState {
    return { ...this.state, previousVersions: [...this.state.previousVersions] };
  }

  // ---- Private methods ----

  /**
   * Aplica bundle staged (extraido na sessao anterior).
   * Chamado durante initialize() no proximo launch.
   */
  private async applyStagedBundleIfAvailable(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: KEYS.STAGED_VERSION });
      if (!value) {
        return;
      }

      const staged: StagedBundle = JSON.parse(value);
      console.log(`[OTA] Found staged bundle v${staged.version}, applying...`);

      // Validate the staged extraction
      const validation = await OtaBundle.validateBundle({ path: staged.path });
      if (!validation.valid) {
        console.error('[OTA] Staged bundle path invalid, clearing...');
        await Preferences.remove({ key: KEYS.STAGED_VERSION });
        return;
      }

      // Save rollback info
      if (!this.state.previousVersions.includes(this.state.currentVersion)) {
        this.state.previousVersions.unshift(this.state.currentVersion);
        if (this.state.previousVersions.length > 2) {
          this.state.previousVersions = this.state.previousVersions.slice(0, 2);
        }
      }

      // Update state
      this.state.currentVersion = staged.version;
      await this.saveState();

      // Set the new path and persist
      await Preferences.set({ key: KEYS.ACTIVE_BUNDLE_PATH, value: staged.path });
      await WebView.setServerBasePath({ path: staged.path });
      await WebView.persistServerBasePath();

      // Clear staging flag
      await Preferences.remove({ key: KEYS.STAGED_VERSION });

      await this.reportStatus('applied', staged.version);
      console.log(`[OTA] Staged bundle v${staged.version} applied. WebView reloading...`);
      // WebView reloads automatically from setServerBasePath
    } catch (error) {
      console.error('[OTA] Error applying staged bundle:', error);
      await Preferences.remove({ key: KEYS.STAGED_VERSION });
    }
  }

  /**
   * Verifica que o path do bundle ativo ainda e valido.
   * Se corrompido, reseta para baseline.
   */
  private async verifyActiveBundlePath(): Promise<void> {
    try {
      const { value: activePath } = await Preferences.get({ key: KEYS.ACTIVE_BUNDLE_PATH });
      if (activePath && this.state.currentVersion !== '1.0.0') {
        const validation = await OtaBundle.validateBundle({ path: activePath });
        if (!validation.valid) {
          console.error('[OTA] Active bundle path invalid, resetting to default...');
          await this.resetToBaseline();
        }
      }
    } catch (error) {
      console.error('[OTA] Error verifying active bundle path:', error);
    }
  }

  /**
   * Reseta para o bundle www/ embutido no APK (baseline)
   */
  private async resetToBaseline(): Promise<void> {
    console.log('[OTA] Resetting to baseline www/...');
    this.state.currentVersion = '1.0.0';
    this.state.consecutiveRollbacks = 0;
    this.state.previousVersions = [];
    await this.saveState();
    await Preferences.remove({ key: KEYS.ACTIVE_BUNDLE_PATH });
    await Preferences.remove({ key: KEYS.STAGED_VERSION });
    await OtaBundle.resetToDefault();
    await this.reportStatus('baseline_revert', '1.0.0');
  }

  private checkForUpdateInBackground(): void {
    // Fire and forget -- nao bloquear a UI
    setTimeout(async () => {
      const versionData = await this.checkForUpdate();
      if (versionData) {
        const downloaded = await this.downloadBundle(versionData);
        if (downloaded) {
          // Stage para proximo launch (nao interrompe uso atual)
          await this.stageBundle(versionData.version);
        }
      }
    }, 0);
  }

  private startHealthCheck(): void {
    // Se estamos em uma versao diferente da baseline, iniciar timer
    if (this.state.currentVersion !== '1.0.0') {
      this.healthCheckTimer = setTimeout(async () => {
        console.error('[OTA] Health check timeout! App did not confirm healthy within 15s.');
        await this.rollback();
      }, environment.bundleHealthCheckTimeoutMs);
    }
  }

  private async loadState(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: KEYS.OTA_STATE });
      if (value) {
        this.state = JSON.parse(value);
      }
    } catch (error) {
      console.error('[OTA] Error loading state:', error);
    }
  }

  private async saveState(): Promise<void> {
    try {
      await Preferences.set({
        key: KEYS.OTA_STATE,
        value: JSON.stringify(this.state),
      });
    } catch (error) {
      console.error('[OTA] Error saving state:', error);
    }
  }

  private async ensureBundleDirectory(): Promise<void> {
    try {
      await Filesystem.mkdir({
        path: 'ota-bundles',
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // Directory may already exist
    }
  }

  private async ensureExtractDirectory(): Promise<void> {
    try {
      await Filesystem.mkdir({
        path: 'ota-bundles/extracted',
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // Directory may already exist
    }
  }

  private async ensureCleanDirectory(dirPath: string): Promise<void> {
    // Delete existing extraction if present, then recreate
    try {
      await Filesystem.rmdir({
        path: dirPath,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // May not exist
    }
    try {
      await Filesystem.mkdir({
        path: dirPath,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // May already exist
    }
  }

  private async cleanupExtractedDir(dirPath: string): Promise<void> {
    try {
      await Filesystem.rmdir({
        path: dirPath,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // Best effort
    }
  }

  private async cleanupOldBundles(): Promise<void> {
    try {
      const result = await Filesystem.readdir({
        path: 'ota-bundles',
        directory: Directory.Data,
      });

      // Cleanup old zip files
      const bundles = result.files
        .filter((f) => f.name.startsWith('bundle-') && f.name.endsWith('.zip'))
        .sort((a, b) => {
          const vA = a.name.replace('bundle-', '').replace('.zip', '');
          const vB = b.name.replace('bundle-', '').replace('.zip', '');
          return this.compareVersions(vB, vA); // Most recent first
        });

      const toDelete = bundles.slice(environment.maxCachedBundles);
      for (const file of toDelete) {
        await Filesystem.deleteFile({
          path: `ota-bundles/${file.name}`,
          directory: Directory.Data,
        });
        console.log(`[OTA] Cleaned up old bundle: ${file.name}`);
      }
    } catch (error) {
      console.error('[OTA] Error cleaning up bundles:', error);
    }

    // Also cleanup extracted directories for versions we no longer need
    try {
      const extractedResult = await Filesystem.readdir({
        path: 'ota-bundles/extracted',
        directory: Directory.Data,
      });

      const keptVersions = new Set([
        this.state.currentVersion,
        ...this.state.previousVersions,
      ]);

      for (const dir of extractedResult.files) {
        const version = dir.name.replace('web-v', '');
        if (!keptVersions.has(version)) {
          await Filesystem.rmdir({
            path: `ota-bundles/extracted/${dir.name}`,
            directory: Directory.Data,
            recursive: true,
          });
          console.log(`[OTA] Cleaned up extracted bundle: ${dir.name}`);
        }
      }
    } catch (error) {
      console.error('[OTA] Error cleaning up extracted bundles:', error);
    }
  }

  /**
   * Calcula SHA-256 de um ArrayBuffer
   */
  private async calculateSha256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verifica HMAC da resposta de versao
   * Em producao, a chave HMAC deve estar no native keychain/keystore
   */
  private async verifyHmac(versionData: VersionResponse): Promise<boolean> {
    try {
      const { value: hmacKey } = await Preferences.get({ key: KEYS.HMAC_KEY });
      if (!hmacKey) {
        // Sem chave HMAC configurada no device -- skip verification
        // Em producao futura, a chave deve ser provisionada via native keystore
        console.warn('[OTA] No HMAC key configured. Skipping verification.');
        return true;
      }

      // Payload to verify: version + sha256 + minVersion + timestamp
      const payload = `${versionData.version}:${versionData.sha256}:${versionData.minVersion}:${versionData.timestamp}`;

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(hmacKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );

      const signatureBytes = this.hexToUint8Array(versionData.hmac);
      const isValid = await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBytes.buffer as ArrayBuffer,
        encoder.encode(payload)
      );

      return isValid;
    } catch (error) {
      console.error('[OTA] HMAC verification error:', error);
      return false;
    }
  }

  /**
   * Reporta status do update ao servidor
   */
  private async reportStatus(status: string, version: string): Promise<void> {
    try {
      await fetch(`${environment.otaServerUrl}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          version,
          currentVersion: this.state.currentVersion,
          platform: Capacitor.getPlatform(),
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Silently fail -- report is best-effort
      console.warn('[OTA] Could not report status to server.');
    }
  }

  /**
   * Compara duas versoes semver. Retorna >0 se a > b, <0 se a < b, 0 se iguais
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) {
        return numA - numB;
      }
    }
    return 0;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private hexToUint8Array(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
