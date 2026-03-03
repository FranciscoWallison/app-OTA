import { Component, OnInit } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonIcon, IonBadge, IonChip, IonLabel,
  IonList, IonItem, IonNote, IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cloudDownloadOutline, phonePortraitOutline,
  cameraOutline, locationOutline,
} from 'ionicons/icons';

import { environment } from '../../environments/environment';
import { OtaManagerService } from '../services/ota-manager.service';
import { ThemeService, AppTheme, APP_THEMES } from '../services/theme.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonButton, IonIcon, IonBadge, IonChip, IonLabel,
    IonList, IonItem, IonNote, IonSpinner,
  ],
})
export class HomePage implements OnInit {
  // Theme
  themes: AppTheme[] = APP_THEMES;
  activeTheme: AppTheme = APP_THEMES[0];

  // OTA
  buildVersion = environment.appVersion;
  currentVersion = '1.0.0';
  platform = 'web';
  checkingUpdate = false;
  updateMessage = '';

  // Haptics
  hapticsAvailable = false;
  lastHaptic = '';

  // Camera
  cameraAvailable = false;
  capturedPhoto: string | null = null;

  // Geolocation
  geoAvailable = false;
  latitude: number | null = null;
  longitude: number | null = null;
  geoLoading = false;
  geoError: string | null = null;

  constructor(
    private otaManager: OtaManagerService,
    private themeService: ThemeService,
  ) {
    addIcons({
      cloudDownloadOutline,
      phonePortraitOutline,
      cameraOutline,
      locationOutline,
    });
  }

  ngOnInit(): void {
    // Platform
    this.platform = Capacitor.getPlatform();

    // Current version from OTA manager
    this.currentVersion = this.otaManager.getCurrentVersion();

    // Active theme
    this.activeTheme = this.themeService.getCurrentTheme();
    this.themeService.getTheme().subscribe((theme) => {
      this.activeTheme = theme;
    });

    // Check plugin availability
    this.hapticsAvailable = Capacitor.isPluginAvailable('Haptics');
    this.cameraAvailable = Capacitor.isPluginAvailable('Camera');
    this.geoAvailable = Capacitor.isPluginAvailable('Geolocation');
  }

  // ---- Theme ----

  selectTheme(themeId: string): void {
    this.themeService.setTheme(themeId);
  }

  // ---- OTA ----

  async checkForUpdate(): Promise<void> {
    this.checkingUpdate = true;
    this.updateMessage = '';

    try {
      const found = await this.otaManager.forceCheckForUpdate();
      if (found) {
        this.updateMessage = 'Nova versao encontrada e preparada! Reinicie o app para aplicar.';
      } else {
        this.updateMessage = 'Nenhuma atualizacao disponivel.';
      }
      // Refresh version display
      this.currentVersion = this.otaManager.getCurrentVersion();
    } catch (error) {
      console.error('[HOME] Error checking for update:', error);
      this.updateMessage = 'Erro ao verificar atualizacao.';
    } finally {
      this.checkingUpdate = false;
    }
  }

  async resetToBaseline(): Promise<void> {
    try {
      await this.otaManager.forceResetToBaseline();
      this.currentVersion = this.otaManager.getCurrentVersion();
      this.updateMessage = 'Resetado para versao baseline (1.0.0).';
    } catch (error) {
      console.error('[HOME] Error resetting to baseline:', error);
      this.updateMessage = 'Erro ao resetar para baseline.';
    }
  }

  // ---- Haptics ----

  async vibrate(): Promise<void> {
    if (!this.hapticsAvailable) return;
    try {
      await Haptics.vibrate({ duration: 300 });
      this.lastHaptic = 'Vibrar (300ms)';
    } catch (error) {
      console.error('[HAPTICS] Vibrate error:', error);
    }
  }

  async impactHaptic(): Promise<void> {
    if (!this.hapticsAvailable) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
      this.lastHaptic = 'Impacto (Heavy)';
    } catch (error) {
      console.error('[HAPTICS] Impact error:', error);
    }
  }

  async notificationHaptic(): Promise<void> {
    if (!this.hapticsAvailable) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
      this.lastHaptic = 'Notificacao (Success)';
    } catch (error) {
      console.error('[HAPTICS] Notification error:', error);
    }
  }

  // ---- Camera ----

  async takePhoto(): Promise<void> {
    if (!this.cameraAvailable) return;
    try {
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      });
      this.capturedPhoto = photo.dataUrl ?? null;
    } catch (error) {
      console.error('[CAMERA] Error:', error);
    }
  }

  // ---- Geolocation ----

  async getLocation(): Promise<void> {
    if (!this.geoAvailable) return;
    this.geoLoading = true;
    this.geoError = null;

    try {
      const perm = await Geolocation.requestPermissions();
      if (perm.location === 'denied') {
        this.geoError = 'Permissao de localizacao negada.';
        this.geoLoading = false;
        return;
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      this.latitude = position.coords.latitude;
      this.longitude = position.coords.longitude;
    } catch (error) {
      console.error('[GEO] Error:', error);
      this.geoError = 'Erro ao obter localizacao. Verifique as permissoes.';
    } finally {
      this.geoLoading = false;
    }
  }
}
