"""Read-only source/converted material audit; does not infer target shader support."""
import importlib.util
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_converter', ROOT / 'tools/convert-native-assets.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)
rows = []
for package in sorted((ROOT / 'assets').iterdir()):
    if not package.is_dir():
        continue
    for model in sorted(package.rglob('*.mdl')):
        source = converter.parse(model)
        materials = {}
        def walk(node):
            if not isinstance(node, dict):
                return
            if 'mesh' in node:
                _, submeshes = converter.mesh(converter.resolve(model.parent, node['mesh'], package))
                for index in range(len(submeshes)):
                    path = converter.resolve(model.parent, node['materials'][index], package)
                    materials.setdefault(path, []).append(node.get('name', 'part'))
            for child in node.get('children', []):
                walk(child)
        walk(source['lods'][0]['node'])
        for index, (material, nodes) in enumerate(materials.items(), 1):
            definition = converter.parse(material)
            texture = ROOT / 'assets_converted' / package.name / 'import' / model.stem / 'LOD0' / f'{model.stem}_{index:02d}_BaseColorMap.png'
            alpha = None
            if texture.exists():
                with Image.open(texture) as im:
                    channel = im.convert('RGBA').getchannel('A')
                    histogram = channel.histogram()
                    alpha = {'range': list(channel.getextrema()), 'non_opaque_pixels': sum(histogram[:255]), 'pixels': im.width * im.height}
            rows.append({'package': package.name, 'model': model.stem, 'part': index,
                         'source_material': str(material.relative_to(ROOT)), 'nodes': nodes,
                         'source_shader': definition.get('type'),
                         'alpha_settings': definition.get('params', {}).get('alpha_test'),
                         'base_color_alpha': alpha})
output = ROOT / 'artifacts/native-import-20261027/material-source-audit.json'
output.write_text(json.dumps({'scope': 'Source LOD0 and converted textures; target shader correctness requires live checks.', 'materials': rows}, indent=2), encoding='utf-8')
print(json.dumps({'output': str(output), 'materials': len(rows), 'mi26': [r for r in rows if r['model'] == 'mil_mi26tc']}, indent=2))
