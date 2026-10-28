"""Install the editable, wordless crowned fan of card backs. No image credits."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent.parent / 'app/public/assets/brand'
PUBLIC.mkdir(parents=True, exist_ok=True)
master = (HERE / 'carddex-master.svg').read_text()
mono = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Launch a Card crowned hand of cards" color="COLOR"><defs><g id="back" fill="none" stroke="currentColor" stroke-linejoin="round"><rect x="-24" y="-38" width="48" height="76" rx="5.2" stroke-width="2.5"/><rect x="-19" y="-33" width="38" height="66" rx="2.5" stroke-width="1.2"/><path d="m0-17 12 17L0 17-12 0Z" stroke-width="1.8"/><path d="m0-7 5 7L0 7-5 0Z" fill="currentColor" stroke="none"/></g><mask id="back-clear"><rect width="128" height="128" fill="white"/><rect x="38" y="45" width="52" height="80" rx="6" fill="black"/></mask></defs><g mask="url(#back-clear)"><g transform="translate(39.5 82.5) rotate(-24)"><use href="#back"/></g><g transform="translate(88.5 82.5) rotate(24)"><use href="#back"/></g></g><g transform="translate(64 85)"><use href="#back"/></g><path d="m32 10 15 10L64 4l17 16 15-10-5.8 18.5H37.8ZM38 28h52l-1.5 5H39.5Z" fill="currentColor"/></svg>'''
for folder in (HERE, PUBLIC):
    (folder / 'carddex.svg').write_text(master)
    (folder / 'carddex-ink.svg').write_text(mono.replace('COLOR', '#29231b'))
    (folder / 'carddex-white.svg').write_text(mono.replace('COLOR', '#ffffff'))
print('Installed the multicolor card-back fan and separate crown; no lettering.')
