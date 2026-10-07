import { headers } from 'next/headers';
import './globals.css';

export const metadata = {
  title: 'ISS-Live-Tracker',
  description: 'Die aktuelle Position der Internationalen Raumstation live auf einer Karte.',
};

// Setzt das Theme vor dem ersten Rendern, damit kein falsches Theme aufblitzt.
// Gespeicherte Wahl hat Vorrang, sonst Systemeinstellung, sonst Dark.
const themeScript = `(function(){try{var t=null;try{t=localStorage.getItem('theme');}catch(e){}
if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default async function RootLayout({ children }) {
  // Nonce aus der Middleware: Das Inline-Skript ist unter der CSP nur mit ihm ausführbar.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
