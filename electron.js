const { app, BrowserWindow } = require('electron');
const path = require('path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000', // Matches your monochromatic theme
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true, // Hides the default file menu for a cleaner look
    icon: path.join(__dirname, 'icon.ico'), // You can add an icon.ico later if you want
  });

  // Load the app.
  // In development, we load from the Vite dev server.
  // In production (the .exe), we load the built index.html.
  const isDev = !app.isPackaged;
  
  if (isDev) {
    // Attempt to connect to localhost until successful
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // Uncomment to debug
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// This method will be called when Electron has finished initialization.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});