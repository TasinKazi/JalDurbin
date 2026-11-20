#!/usr/bin/env bash
# JalDurbin Backend Production Build Script for Render
set -o errexit

echo "==> [JalDurbin Build] Upgrading pip, setuptools, and wheel..."
pip install --upgrade pip setuptools wheel

echo "==> [JalDurbin Build] Installing Python packages with PostGIS/GeoAlchemy2 dependencies..."
pip install --prefer-binary -r requirements.txt

echo "==> [JalDurbin Build] Verifying GeoAlchemy2 & Shapely spatial engine integrity..."
python -c "import geoalchemy2, shapely; print(f'[OK] GeoAlchemy2 {geoalchemy2.__version__} & Shapely {shapely.__version__} loaded successfully.')"

echo "==> [JalDurbin Build] Build completed."
