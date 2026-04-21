#!/bin/bash
# Pear Desktop Installer for Arch/CachyOS
set -e

APP_NAME="Pear Desktop"
INSTALL_DIR="$HOME/pear-desktop"
DESKTOP_FILE="$HOME/.local/share/applications/pear-desktop.desktop"
BIN_LINK="$HOME/.local/bin/pear-desktop"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       🍐 Pear Desktop Installer          ║"
echo "║       YouTube Music Desktop App           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Find the app directory (electron-builder extracts to a folder)
APP_SOURCE=""
for dir in "$SCRIPT_DIR"/*/; do
  if [ -f "$dir/youtube-music" ] || [ -f "$dir/pear-desktop" ]; then
    APP_SOURCE="$dir"
    break
  fi
done

# If no subdirectory, check current directory
if [ -z "$APP_SOURCE" ]; then
  if [ -f "$SCRIPT_DIR/youtube-music" ] || [ -f "$SCRIPT_DIR/pear-desktop" ]; then
    APP_SOURCE="$SCRIPT_DIR"
  fi
fi

if [ -z "$APP_SOURCE" ]; then
  echo "❌ Error: No se encontró el ejecutable de la aplicación."
  echo "   Archivos encontrados en $SCRIPT_DIR:"
  ls -la "$SCRIPT_DIR"
  exit 1
fi

echo "📁 Instalando en: $INSTALL_DIR"

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/share/applications"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"

# Remove previous installation if exists
if [ -d "$INSTALL_DIR" ]; then
  echo "🔄 Eliminando instalación anterior..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
fi

# Copy app files
echo "📦 Copiando archivos..."
cp -r "$APP_SOURCE"/* "$INSTALL_DIR/"

# Find the main executable
MAIN_EXEC=""
if [ -f "$INSTALL_DIR/youtube-music" ]; then
  MAIN_EXEC="youtube-music"
elif [ -f "$INSTALL_DIR/pear-desktop" ]; then
  MAIN_EXEC="pear-desktop"
fi

if [ -z "$MAIN_EXEC" ]; then
  echo "❌ Error: No se encontró el binario principal."
  exit 1
fi

chmod +x "$INSTALL_DIR/$MAIN_EXEC"

# Create symlink in ~/.local/bin
echo "🔗 Creando enlace en ~/.local/bin/pear-desktop..."
ln -sf "$INSTALL_DIR/$MAIN_EXEC" "$BIN_LINK"

# Copy icon if available
ICON_PATH=""
if [ -f "$INSTALL_DIR/resources/assets/icon_linux.png" ]; then
  ICON_PATH="$HOME/.local/share/icons/hicolor/256x256/apps/pear-desktop.png"
  cp "$INSTALL_DIR/resources/assets/icon_linux.png" "$ICON_PATH"
elif [ -f "$INSTALL_DIR/resources/app.asar.unpacked/assets/icon_linux.png" ]; then
  ICON_PATH="$HOME/.local/share/icons/hicolor/256x256/apps/pear-desktop.png"
  cp "$INSTALL_DIR/resources/app.asar.unpacked/assets/icon_linux.png" "$ICON_PATH"
fi

# Create .desktop file
echo "🖥️  Creando entrada de escritorio..."
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=Pear Desktop
Comment=YouTube Music Desktop App bundled with custom plugins
Exec=$INSTALL_DIR/$MAIN_EXEC --no-sandbox %U
Icon=${ICON_PATH:-pear-desktop}
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Music;Player;
StartupWMClass=com.github.th_ch.youtube_music
MimeType=x-scheme-handler/youtube-music;
EOF

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

echo ""
echo "✅ ¡Instalación completada!"
echo ""
echo "   Ejecutar desde terminal:  pear-desktop"
echo "   Ruta del ejecutable:      $INSTALL_DIR/$MAIN_EXEC"
echo "   Entrada de escritorio:    $DESKTOP_FILE"
echo ""
echo "   Para desinstalar:  rm -rf $INSTALL_DIR $BIN_LINK $DESKTOP_FILE"
echo ""
