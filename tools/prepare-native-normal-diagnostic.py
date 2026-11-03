"""Reconstruct positive Z from explicitly tagged RG source normals for an A/B test."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def rg_to_rgb(pixels):
    xy = pixels[..., :2].astype(np.float32) / 127.5 - 1
    z = np.sqrt(np.maximum(0, 1 - np.sum(xy * xy, axis=-1)))
    result = np.empty((*pixels.shape[:2], 4), dtype=np.uint8)
    result[..., :2] = pixels[..., :2]
    result[..., 2] = np.rint((z + 1) * 127.5).astype(np.uint8)
    result[..., 3] = 255
    return result

if __name__ == '__main__':
    flat = rg_to_rgb(np.array([[[128, 128, 0, 255], [255, 128, 0, 255]]], dtype=np.uint8))
    assert flat[0, 0, 2] == 255 and flat[0, 1, 2] == 128
    definition = ROOT / 'assets_converted/heliport-native/metadata/native/base/stations/air/heliport/mat/heliport_tower_main_roof.mtl.json'
    data = json.loads(definition.read_text(encoding='utf-8'))
    assert data['params']['map_normal']['fragmentSamplers']['normalTex']['redGreen'] is True
    source = ROOT / 'assets_converted/heliport-native/import/heliport_terminal/LOD0/heliport_terminal_10_NormalMap.png'
    output = ROOT / 'artifacts/native-import-20261027/normal-diagnostic'
    output.mkdir(exist_ok=True)
    with Image.open(source) as im:
        original = np.array(im.convert('RGBA'))
    converted = rg_to_rgb(original)
    assert np.array_equal(original[..., :2], converted[..., :2])
    target = output / 'TerminalMainRoofRGBNormal.png'
    Image.fromarray(converted).save(target)
    report = {'source': str(source), 'output': str(target), 'source_metadata': str(definition),
              'size': list(original.shape[:2]), 'source_blue_range': [int(original[..., 2].min()), int(original[..., 2].max())],
              'output_blue_range': [int(converted[..., 2].min()), int(converted[..., 2].max())],
              'rg_preserved': True, 'status': 'diagnostic only; live A/B required'}
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
