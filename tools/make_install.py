#!/usr/bin/env python3
"""Prepare the first install (stock firmware -> open-smc-pad bootloader) for the web page.

Runs in CI next to a checkout of open-smc-pad (the bootloader built by its fw/boot/build.sh and
packaged by host/jlimage.py) and uses its own host code, so the bytes are the ones its
host/install_from_stock.py would write. The stock-dependent parts (the pad's directory and
cfg_tool.bin) are taken from jlimage's defaults, which match the factory image; the page reads
the pad's own directory and refuses to write if anything differs.

    python3 tools/make_install.py OPEN_SMC_PAD_DIR OUT_DIR

Writes OUT_DIR/installer.bin (to write at INSTALL_DIR, already SFC-encrypted), stage.bin (at
STAGE) and install.json (addresses, the expected directory and cfg_tool.bin).
"""
import json
import sys
from pathlib import Path

osp = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2])
sys.path.insert(0, str(osp / "host"))

import bootpkg            # noqa: E402
import jlimage as J       # noqa: E402

template, cfg = J.template_and_cfg(None)
installer = bootpkg.installer_area(template, cfg)
raw = J.sfc_encrypt_at(installer, bootpkg.INSTALL_DIR)
stage = bootpkg.stage(bootpkg.ERASE_STOCK)

out.mkdir(parents=True, exist_ok=True)
(out / "installer.bin").write_bytes(raw)
(out / "stage.bin").write_bytes(stage)
manifest = {
    "installDir": bootpkg.INSTALL_DIR,
    "stage": bootpkg.STAGE,
    "stageEnd": bootpkg.STAGE_END,
    "dest": bootpkg.DEST,
    "installerBytes": len(raw),
    "stageBytes": len(stage),
    # the directory entries as the factory image has them (offset/size/CRCs of entries 0-2 vary)
    "template": [e.pack(False).hex() for e in template],
    "cfgTool": cfg.hex(),
}
(out / "install.json").write_text(json.dumps(manifest, indent=1))
print(f"installer {len(raw):#x} bytes at {bootpkg.INSTALL_DIR:#x}, stage {len(stage):#x} bytes at {bootpkg.STAGE:#x}")
