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
    await this.themeService.initialize();
    await this.otaManager.initialize();
    this.otaManager.confirmHealthy();
  }
}
