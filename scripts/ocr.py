"""Recognize captcha image using Python ddddocr. Usage: python ocr.py <image_path>"""
import sys

import ddddocr

def main() -> None:
    if len(sys.argv) < 2:
        print("", end="")
        sys.exit(1)
    ocr = ddddocr.DdddOcr(show_ad=False)
    with open(sys.argv[1], "rb") as f:
        print(ocr.classification(f.read()), end="")


if __name__ == "__main__":
    main()
