import './styles/app.css';
import { mountApp, showServiceWorkerUpdateToast } from './app';
import { registerSW } from 'virtual:pwa-register';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app root missing');
}

void mountApp(app);

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    showServiceWorkerUpdateToast(() => {
      void updateSW(true);
    });
  },
  onOfflineReady() {
    console.info('Daily Meal Tracker ready for offline use.');
  },
});
