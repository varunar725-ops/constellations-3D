#!/usr/bin/env python3
"""Convert Yale BSC5 + MarcvdSluys ConstellationLines into JS data files."""
import json, re

# ---------- parse stars ----------
stars_raw = json.load(open('bsc5-short.json'))
stars = {}
for s in stars_raw:
    try:
        hr = int(s['HR'])
    except (KeyError, ValueError):
        continue
    # RA "00h 05m 09.9s"
    ra = 0.0
    m = re.match(r'\s*(-?\d+)h\s*(\d+)m\s*([\d.]+)s', s.get('RA', ''))
    if m:
        ra = (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))) * 15.0 / 3600.0
    # Dec "+45° 13′ 45″"
    dec = 0.0
    m = re.match(r"\s*(-?\d+)[°º]\s*(\d+)[\u2032']\s*([\d.]+)[\u2033\"]", s.get('Dec', ''))
    if m:
        sign = -1 if m.group(1).startswith('-') else 1
        dec = sign * (int(m.group(1)) + int(m.group(2)) / 60.0 + float(m.group(3)) / 3600.0)
    try:
        mag = float(s.get('V', '9.0'))
    except ValueError:
        mag = 9.0
    name = s.get('N') or ''
    if not name:
        bay = s.get('B', '')
        flam = s.get('F', '')
        name = (bay + (' ' + flam if flam else '')).strip()
    stars[hr] = {
        'hr': hr,
        'ra': round(ra, 6),
        'dec': round(dec, 6),
        'mag': round(min(mag, 9.9), 2),
        'name': name,
        'con': s.get('C', '') or '',
    }

# ---------- parse constellation lines ----------
const_names = {
    'And': 'Andromeda', 'Ant': 'Antennae', 'Aps': 'Apus', 'Aql': 'Aquila',
    'Aqr': 'Aquarius', 'Ara': 'Altar', 'Ari': 'Aries', 'Aur': 'Auriga',
    'Boo': 'Boötes', 'Cae': 'Caelum', 'Cam': 'Camelopardalis', 'Cap': 'Capricornus',
    'Car': 'Carina', 'Cas': 'Cassiopeia', 'Cen': 'Centaurus', 'Cep': 'Cepheus',
    'Cet': 'Cetus', 'Cha': 'Chamaeleon', 'Cir': 'Circinus', 'Cnc': 'Cancer',
    'CMa': 'Canis Major', 'CMi': 'Canis Minor', 'CVn': 'Canes Venatici',
    'Col': 'Columba', 'Com': 'Coma Berenices', 'CrA': 'Corona Australis',
    'CrB': 'Corona Borealis', 'Cru': 'Crux', 'Crv': 'Corvus', 'Crt': 'Crater',
    'Cyg': 'Cygnus', 'Del': 'Delphinus', 'Dor': 'Dorado', 'Dra': 'Draco',
    'Equ': 'Equuleus', 'Eri': 'Eridanus', 'For': 'Fornax', 'Gem': 'Gemini',
    'Gru': 'Grus', 'Her': 'Hercules', 'Hor': 'Horologium', 'Hya': 'Hydra',
    'Hyi': 'Hydrus', 'Ind': 'Indus', 'Lac': 'Lacerta', 'Leo': 'Leo',
    'Lep': 'Lepus', 'Lib': 'Libra', 'LMi': 'Leo Minor', 'Lup': 'Lupus',
    'Lyn': 'Lynx', 'Lyr': 'Lyra', 'Men': 'Mensa', 'Mic': 'Microscopium',
    'Mon': 'Monoceros', 'Mus': 'Musca', 'Nor': 'Norma', 'Oct': 'Octans',
    'Oph': 'Ophiuchus', 'Ori': 'Orion', 'Pav': 'Pavo', 'Peg': 'Pegasus',
    'Per': 'Perseus', 'Phe': 'Phoenix', 'Pic': 'Pictor', 'PsA': 'Piscis Austrinus',
    'Psc': 'Pisces', 'Pup': 'Puppis', 'Pyx': 'Pyxis', 'Ret': 'Reticulum',
    'Scl': 'Sculptor', 'Sco': 'Scorpius', 'Sct': 'Scutum', 'Ser': 'Serpens',
    'Sex': 'Sextans', 'Sge': 'Sagitta', 'Sgr': 'Sagittarius', 'Tau': 'Taurus',
    'Tel': 'Telescopium', 'TrA': 'Triangulum Australe', 'Tri': 'Triangulum',
    'Tuc': 'Tucana', 'UMa': 'Ursa Major', 'UMi': 'Ursa Minor', 'Vel': 'Vela',
    'Vir': 'Virgo', 'Vol': 'Volans', 'Vul': 'Vulpecula',
}

constellations = {}
order = []
for line in open('ConstellationLines.dat'):
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    parts = line.split()
    abbr = parts[0]
    n = int(parts[1])
    hrs = [int(x) for x in parts[2:2 + n]]
    if abbr not in constellations:
        constellations[abbr] = {'abbr': abbr, 'name': const_names.get(abbr, abbr), 'lines': []}
        order.append(abbr)
    constellations[abbr]['lines'].append(hrs)

# ---------- validation ----------
missing = set()
for abbr in order:
    for line in constellations[abbr]['lines']:
        for hr in line:
            if hr not in stars:
                missing.add(hr)
if missing:
    print('WARNING missing HR stars:', sorted(missing))
else:
    print('all line stars found in catalog ✓')

# ---------- emit ----------
with open('stars.js', 'w') as f:
    f.write('// Star data: Yale Bright Star Catalogue, 5th revised edition (HR numbers).\n')
    f.write('// RA/Dec J2000 in degrees, visual magnitude, IAU name (if any), constellation abbr.\n')
    f.write('window.STAR_DATA = ')
    json.dump([stars[hr] for hr in sorted(stars)], f, separators=(',', ':'))
    f.write(';\n')

with open('constellations.js', 'w') as f:
    f.write('// Constellation stick figures: HR star numbers to connect in order.\n')
    f.write('// Source: MarcvdSluys/ConstellationLines (CC BY 4.0).\n')
    f.write('window.CONST_DATA = ')
    json.dump([constellations[a] for a in order], f, separators=(',', ':'))
    f.write(';\n')

print('stars:', len(stars), 'constellations:', len(order))
print('labeled stars (name):', sum(1 for s in stars.values() if s['name']))
