import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, Observable } from 'rxjs';

export interface AppTheme {
  id: string;
  name: string;
  emoji: string;
  primary: string;
  primaryRgb: string;
  primaryContrast: string;
  primaryShade: string;
  primaryTint: string;
  secondary: string;
  secondaryRgb: string;
  tertiary: string;
  tertiaryRgb: string;
}

const THEME_KEY = 'app-theme-1.2.2';

export const APP_THEMES: AppTheme[] = [
  {
    id: 'blue',
    name: 'Azul Padrao',
    emoji: '🔵',
    primary: '#3880ff',
    primaryRgb: '56, 128, 255',
    primaryContrast: '#ffffff',
    primaryShade: '#3171e0',
    primaryTint: '#4c8dff',
    secondary: '#3dc2ff',
    secondaryRgb: '61, 194, 255',
    tertiary: '#5260ff',
    tertiaryRgb: '82, 96, 255',
  },
  {
    id: 'green',
    name: 'Verde Natureza',
    emoji: '🟢',
    primary: '#2dd36f',
    primaryRgb: '45, 211, 111',
    primaryContrast: '#ffffff',
    primaryShade: '#28ba62',
    primaryTint: '#42d77d',
    secondary: '#0ec254',
    secondaryRgb: '14, 194, 84',
    tertiary: '#17a2b8',
    tertiaryRgb: '23, 162, 184',
  },
  {
    id: 'purple',
    name: 'Roxo Moderno',
    emoji: '🟣',
    primary: '#7c3aed',
    primaryRgb: '124, 58, 237',
    primaryContrast: '#ffffff',
    primaryShade: '#6d34d1',
    primaryTint: '#894def',
    secondary: '#ec4899',
    secondaryRgb: '236, 72, 153',
    tertiary: '#f59e0b',
    tertiaryRgb: '245, 158, 11',
  },
  {
    id: 'red',
    name: 'Vermelho Fogo',
    emoji: '🔴',
    primary: '#e63946',
    primaryRgb: '230, 57, 70',
    primaryContrast: '#ffffff',
    primaryShade: '#cc323e',
    primaryTint: '#e94d59',
    secondary: '#f4a261',
    secondaryRgb: '244, 162, 97',
    tertiary: '#e76f51',
    tertiaryRgb: '231, 111, 81',
  },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private currentTheme$ = new BehaviorSubject<AppTheme>(APP_THEMES[3]);

  getTheme(): Observable<AppTheme> {
    return this.currentTheme$.asObservable();
  }

  getCurrentTheme(): AppTheme {
    return this.currentTheme$.value;
  }

  async initialize(): Promise<void> {
    const { value } = await Preferences.get({ key: THEME_KEY });
    const theme = APP_THEMES.find((t) => t.id === value) ?? APP_THEMES[3];
    this.applyTheme(theme);
  }

  async setTheme(themeId: string): Promise<void> {
    const theme = APP_THEMES.find((t) => t.id === themeId);
    if (!theme) return;
    await Preferences.set({ key: THEME_KEY, value: themeId });
    this.applyTheme(theme);
  }

  private applyTheme(theme: AppTheme): void {
    const root = document.documentElement;
    root.style.setProperty('--ion-color-primary', theme.primary);
    root.style.setProperty('--ion-color-primary-rgb', theme.primaryRgb);
    root.style.setProperty('--ion-color-primary-contrast', theme.primaryContrast);
    root.style.setProperty('--ion-color-primary-shade', theme.primaryShade);
    root.style.setProperty('--ion-color-primary-tint', theme.primaryTint);
    root.style.setProperty('--ion-color-secondary', theme.secondary);
    root.style.setProperty('--ion-color-secondary-rgb', theme.secondaryRgb);
    root.style.setProperty('--ion-color-tertiary', theme.tertiary);
    root.style.setProperty('--ion-color-tertiary-rgb', theme.tertiaryRgb);
    this.currentTheme$.next(theme);
    console.log(`[THEME] Applied: ${theme.name} (${theme.id})`);
  }
}
