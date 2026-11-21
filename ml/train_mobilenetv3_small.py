"""MobileNetV3-Small baseline for good/defective green beans. NOT RUN in the sprint.

This script has never been executed: PyTorch was not installed. It may need
fixes on first run. It writes its real results to ml/results_lojano.json and
nothing else in the repository states a result for it.

    pip install torch torchvision kagglehub
    python ml/train_mobilenetv3_small.py

Settings come from ml/experiment_lojano_mobilenetv3.json. Datasets and weights
stay outside Git (kagglehub cache and ml/artifacts/, both ignored).
"""
import json
import os
import random

import kagglehub
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = json.load(open(os.path.join(HERE, "experiment_lojano_mobilenetv3.json"), encoding="utf-8"))
CLASSES = list(CONFIG["class_mapping"].keys())  # folder names; index is the label
T = CONFIG["training"]


def list_images(root, folders):
    items = []
    for folder in folders:
        label = CLASSES.index(os.path.basename(folder))
        full = os.path.join(root, *folder.split("/"))
        for name in sorted(os.listdir(full)):
            if name.lower().endswith((".jpg", ".jpeg", ".png")):
                items.append((os.path.join(full, name), label))
    return items


class Beans(Dataset):
    def __init__(self, items, transform):
        self.items, self.transform = items, transform

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        path, label = self.items[index]
        return self.transform(Image.open(path).convert("RGB")), label


def evaluate(model, loader):
    model.eval()
    matrix = [[0, 0], [0, 0]]  # matrix[true][predicted]
    wrong = []
    with torch.no_grad():
        for start, (images, labels) in enumerate(loader):
            predicted = model(images).argmax(dim=1)
            for offset, (truth, guess) in enumerate(zip(labels.tolist(), predicted.tolist())):
                matrix[truth][guess] += 1
                if truth != guess:
                    wrong.append(loader.dataset.items[start * loader.batch_size + offset][0])
    total = sum(map(sum, matrix))
    return {"accuracy": (matrix[0][0] + matrix[1][1]) / total, "confusion_matrix_true_by_predicted": matrix,
            "classes": CLASSES, "count": total, "misclassified_files": [os.path.basename(p) for p in wrong]}


def main():
    random.seed(CONFIG["splits"]["train_and_validation"]["seed"])
    torch.manual_seed(CONFIG["splits"]["train_and_validation"]["seed"])
    root = kagglehub.dataset_download(CONFIG["dataset"]["ref"])
    pool = list_images(root, CONFIG["splits"]["train_and_validation"]["folders"])
    random.shuffle(pool)
    cut = int(len(pool) * (1 - CONFIG["splits"]["train_and_validation"]["validation_fraction"]))
    train_items, val_items = pool[:cut], pool[cut:]
    test_items = list_images(root, CONFIG["splits"]["held_out_test"]["folders"])

    normalize = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    size = T["image_size"]
    augment = transforms.Compose([transforms.Resize((size, size)), transforms.RandomHorizontalFlip(), transforms.RandomVerticalFlip(),
                                  transforms.RandomRotation(15), transforms.ColorJitter(0.1, 0.1, 0.1), transforms.ToTensor(), normalize])
    plain = transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(), normalize])
    train = DataLoader(Beans(train_items, augment), batch_size=T["batch_size"], shuffle=True)
    val = DataLoader(Beans(val_items, plain), batch_size=T["batch_size"])
    test = DataLoader(Beans(test_items, plain), batch_size=T["batch_size"])

    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, len(CLASSES))
    loss_fn = nn.CrossEntropyLoss()
    history = []
    stages = [(T["epochs_frozen_backbone"], T["learning_rate_head"], False), (T["epochs_fine_tune"], T["learning_rate_fine_tune"], True)]
    for epochs, rate, train_backbone in stages:
        for parameter in model.features.parameters():
            parameter.requires_grad = train_backbone
        optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=rate)
        for _ in range(epochs):
            model.train()
            for images, labels in train:
                optimizer.zero_grad()
                loss_fn(model(images), labels).backward()
                optimizer.step()
            history.append({"backbone_trained": train_backbone, "validation_accuracy": evaluate(model, val)["accuracy"]})

    os.makedirs(os.path.join(HERE, "artifacts"), exist_ok=True)
    torch.save(model.state_dict(), os.path.join(HERE, "artifacts", "mobilenetv3_small_lojano.pt"))
    results = {"dataset": CONFIG["dataset"], "split_sizes": {"train": len(train_items), "validation": len(val_items), "held_out_test": len(test_items)},
               "validation_history": history, "held_out_test": evaluate(model, test)}
    json.dump(results, open(os.path.join(HERE, "results_lojano.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(results["held_out_test"], indent=1))


if __name__ == "__main__":
    main()
