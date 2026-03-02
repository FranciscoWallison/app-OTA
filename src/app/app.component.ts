import { Component, OnInit } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { OtaManagerService } from './services/ota-manager.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  constructor(
    private otaManager: OtaManagerService,
    private themeService: ThemeService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.themeService.initialize();
    } catch (error) {
      console.error('[APP] Theme init failed:', error);
    }

    try {
      await this.otaManager.initialize();
      this.otaManager.confirmHealthy();
    } catch (error) {
      console.error('[APP] OTA init failed:', error);
    }
  }
}
