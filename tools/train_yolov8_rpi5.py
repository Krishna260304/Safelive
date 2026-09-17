#!/usr/bin/env python3
"""Prepare the SafeLive archive and train a YOLOv8 detector.

The source archive contains several datasets whose labels have already been
mapped to the shared SafeLive class IDs (0..9). This script creates a unified
dataset using symlinks, so the original images are not copied or modified.
"""

from __future__ import annotations

import argparse
import os
import shutil
from collections import Counter
from pathlib import Path

import yaml


DEFAULT_CLASSES = [
    "Damaged Road issues",
    "Pothole Issues",
    "Illegal Parking Issues",
    "Broken Road Sign Issues",
    "Fallen trees",
    "Littering/Garbage on Public Places",
    "Vandalism Issues",
    "Dead Animal Pollution",
    "Damaged concrete structures",
    "Damaged Electric wires and poles",
]

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=Path("/home/msi/Downloads/archive"))
    parser.add_argument("--prepared", type=Path, default=Path("runs/safelive_dataset"))
    parser.add_argument("--model", default="yolov8l.pt", help="Pretrained YOLOv8 checkpoint")
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--imgsz", type=int, default=960)
    parser.add_argument("--batch", default="-1", help="-1 enables Ultralytics auto batch sizing")
    parser.add_argument("--workers", type=int, default=min(12, os.cpu_count() or 4))
    parser.add_argument("--device", default="0")
    parser.add_argument("--name", default="safelive-yolov8l")
    parser.add_argument("--export", choices=("none", "onnx", "ncnn"), default="ncnn")
    parser.add_argument("--prepare-only", action="store_true", help="Validate and prepare the dataset without training")
    return parser.parse_args()


def class_names(archive: Path) -> list[str]:
    config_path = archive / "config.yaml"
    if config_path.exists():
        data = yaml.safe_load(config_path.read_text()) or {}
        names = data.get("names")
        if isinstance(names, dict):
            ordered = [names[k] for k in sorted(names, key=lambda value: int(value))]
            if len(ordered) == len(DEFAULT_CLASSES):
                return [str(item) for item in ordered]
    return DEFAULT_CLASSES


def link(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        target.unlink()
    shutil.copy2(source, target)


def prepare_dataset(archive: Path, prepared: Path) -> tuple[Path, list[str], Counter[int]]:
    if not archive.is_dir():
        raise FileNotFoundError(f"Archive directory does not exist: {archive}")
    if prepared.exists():
        shutil.rmtree(prepared)

    names = class_names(archive)
    counts: Counter[int] = Counter()
    linked = 0
    skipped = 0

    for dataset_dir in sorted(path for path in archive.iterdir() if path.is_dir()):
        # Roboflow exports commonly use Dataset/Dataset/{train,valid,test}.
        source_root = dataset_dir / dataset_dir.name
        if not source_root.is_dir():
            source_root = dataset_dir
        for source_split, output_split in (("train", "train"), ("valid", "val"), ("val", "val"), ("test", "test")):
            images_dir = source_root / source_split / "images"
            labels_dir = source_root / source_split / "labels"
            if not images_dir.is_dir() or not labels_dir.is_dir():
                continue

            for image in sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_EXTENSIONS):
                label = labels_dir / f"{image.stem}.txt"
                if not label.exists():
                    skipped += 1
                    continue

                for line_number, line in enumerate(label.read_text(errors="replace").splitlines(), 1):
                    fields = line.split()
                    if not fields:
                        continue
                    class_id = int(fields[0])
                    if not 0 <= class_id < len(names):
                        raise ValueError(f"Class {class_id} in {label} is outside 0..{len(names) - 1}")
                    raw_coords = [float(value) for value in fields[1:]]
                    if len(raw_coords) == 4:
                        coords = raw_coords
                    elif len(raw_coords) >= 6 and len(raw_coords) % 2 == 0:
                        # Convert YOLO segmentation polygon x1,y1,... to a box.
                        xs = raw_coords[0::2]
                        ys = raw_coords[1::2]
                        x_min, x_max = min(xs), max(xs)
                        y_min, y_max = min(ys), max(ys)
                        coords = [
                            (x_min + x_max) / 2,
                            (y_min + y_max) / 2,
                            x_max - x_min,
                            y_max - y_min,
                        ]
                    else:
                        raise ValueError(f"Invalid YOLO label {label}:{line_number}: expected box or polygon")
                    if any(value < 0 or value > 1 for value in coords):
                        raise ValueError(f"Non-normalized coordinates in {label}:{line_number}")
                    counts[class_id] += 1

                unique_name = f"{dataset_dir.name}__{image.name}"
                link(image, prepared / "images" / output_split / unique_name)
                output_label = prepared / "labels" / output_split / f"{Path(unique_name).stem}.txt"
                source_text = label.read_text(errors="replace")
                normalized_lines = []
                for line in source_text.splitlines():
                    fields = line.split()
                    if not fields:
                        continue
                    raw_coords = [float(value) for value in fields[1:]]
                    if len(raw_coords) > 4:
                        xs = raw_coords[0::2]
                        ys = raw_coords[1::2]
                        x_min, x_max = min(xs), max(xs)
                        y_min, y_max = min(ys), max(ys)
                        raw_coords = [(x_min + x_max) / 2, (y_min + y_max) / 2, x_max - x_min, y_max - y_min]
                    normalized_lines.append(" ".join([fields[0], *(f"{value:.8f}" for value in raw_coords)]))
                output_label.parent.mkdir(parents=True, exist_ok=True)
                output_label.write_text("\n".join(normalized_lines) + "\n")
                linked += 1

    if not linked:
        raise RuntimeError("No image/label pairs were found in the archive")

    dataset_yaml = prepared / "dataset.yaml"
    dataset_yaml.write_text(yaml.safe_dump({
        "path": str(prepared.resolve()),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {index: name for index, name in enumerate(names)},
    }, sort_keys=False))

    print(f"Prepared {linked:,} image/label pairs at {prepared}")
    if skipped:
        print(f"Skipped {skipped:,} images without matching labels")
    print("Label distribution:", dict(sorted(counts.items())))
    return dataset_yaml, names, counts


def train(args: argparse.Namespace, dataset_yaml: Path) -> None:
    from ultralytics import YOLO

    batch = -1 if str(args.batch).lower() in {"-1", "auto"} else int(args.batch)
    model = YOLO(args.model)
    results = model.train(
        data=str(dataset_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=batch,
        device=args.device,
        workers=args.workers,
        pretrained=True,
        optimizer="auto",
        amp=True,
        cache=False,
        patience=40,
        cos_lr=True,
        close_mosaic=15,
        degrees=3.0,
        translate=0.10,
        scale=0.50,
        fliplr=0.5,
        mosaic=1.0,
        mixup=0.10,
        project="runs/detect",
        name=args.name,
        exist_ok=True,
        save=True,
        save_period=10,
        plots=True,
    )

    best_path = Path(results.save_dir) / "weights" / "best.pt"
    if not best_path.exists():
        raise FileNotFoundError(f"Training finished but best checkpoint was not found: {best_path}")

    best = YOLO(str(best_path))
    print("Validation metrics:")
    best.val(data=str(dataset_yaml), split="val", imgsz=args.imgsz, device=args.device)
    print("Held-out test metrics:")
    best.val(data=str(dataset_yaml), split="test", imgsz=args.imgsz, device=args.device)

    if args.export != "none":
        print(f"Exporting {args.export} model for Raspberry Pi 5...")
        best.export(format=args.export, imgsz=args.imgsz)

    print(f"Best checkpoint: {best_path.resolve()}")


def main() -> None:
    args = parse_args()
    dataset_yaml, _, _ = prepare_dataset(args.archive.resolve(), args.prepared.resolve())
    if args.prepare_only:
        return
    train(args, dataset_yaml)


if __name__ == "__main__":
    main()
