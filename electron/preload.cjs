const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pawprint", {
  cardPhoto: rect => ipcRenderer.invoke('paw:card-photo',rect),
  cardCreate: id => ipcRenderer.invoke('paw:card-create',id),
  cardCopy: id => ipcRenderer.invoke('paw:card-copy',id),
  cardClipboard: () => ipcRenderer.invoke('paw:card-clipboard'),
  cardRead: code => ipcRenderer.invoke('paw:card-read',code),
  cardVisit: code => ipcRenderer.invoke('paw:card-visit',code),
  cardDismiss: id => ipcRenderer.invoke('paw:card-dismiss',id),
  previewCompanion: () => ipcRenderer.invoke("paw:companion-preview"),
  playBall: () => ipcRenderer.invoke("paw:ball"),
  performSkill: (petId, skillId) => ipcRenderer.invoke("paw:skill", petId, skillId),
  previewPetScale: (percent) => ipcRenderer.invoke("paw:scale-preview", percent),
  onIdle: (callback) => {
    const listener = (_, idle) => callback(idle);
    ipcRenderer.on("paw:idle", listener);
    return () => ipcRenderer.removeListener("paw:idle", listener);
  },
  lan: (action) => ipcRenderer.invoke("paw:lan", action),
  perform: (petId, guestId) =>
    ipcRenderer.invoke("paw:perform", petId, guestId),
  guestMenu: (id) => ipcRenderer.invoke("paw:guest-menu", id),
  checkUpdates: () => ipcRenderer.invoke("paw:update-check"),
  installUpdate: () => ipcRenderer.invoke("paw:update-install"),
  getState: () => ipcRenderer.invoke("paw:state"),
  command: (command) => ipcRenderer.invoke("paw:command", command),
  refreshUsage: () => ipcRenderer.invoke("paw:refresh"),
  refreshQuota: () => ipcRenderer.invoke("paw:quota-refresh"),
  recoverTray: () => ipcRenderer.invoke("paw:tray-recover"),
  previewMotion: () => ipcRenderer.invoke("paw:motion-preview"),
  chooseUsageDirectory: () => ipcRenderer.invoke("paw:usage-directory"),
  exportSave: () => ipcRenderer.invoke("paw:export"),
  showHome: (section) => ipcRenderer.invoke("paw:home", section),
  showWorkPanel: () => ipcRenderer.invoke("paw:activity-panel"),
  hideWorkPanel: () => ipcRenderer.invoke("paw:activity-panel-hide"),
  showClientGuide: kind => ipcRenderer.invoke("paw:helper-guide",kind),
  closeClientGuide: () => ipcRenderer.invoke("paw:helper-close"),
  openClientHelperSettings: kind => ipcRenderer.invoke("paw:helper-settings",kind),
  connectAttention: () => ipcRenderer.invoke("paw:attention-connect"),
  disconnectAttention: () => ipcRenderer.invoke("paw:attention-disconnect"),
  openWorkSession: id => ipcRenderer.invoke("paw:activity-open", id),
  openClient: () => ipcRenderer.invoke("paw:client"),
  showMenu: () => ipcRenderer.invoke("paw:menu"),
  setInteractive: (interactive) => ipcRenderer.send("paw:pointer", interactive),
  setControlsHovered: hovered => ipcRenderer.send("paw:controls-hover", hovered),
  setControlsPressed: pressed => ipcRenderer.send("paw:controls-press", pressed),
  dragPet: (data) => ipcRenderer.send("paw:drag", data),
  onNavigate: (callback) => {
    const listener = (_, section) => callback(section);
    ipcRenderer.on("paw:navigate", listener);
    return () => ipcRenderer.removeListener("paw:navigate", listener);
  },
  onState: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on("paw:changed", listener);
    return () => ipcRenderer.removeListener("paw:changed", listener);
  },
});
