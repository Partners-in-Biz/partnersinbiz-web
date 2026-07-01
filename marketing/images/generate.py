#!/usr/bin/env python3
"""
Image generation script for Partners in Biz campaign.
Uses xAI Grok Imagine API (NOT Gemini/Imagen).
"""

import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

# Master style suffix for Partners in Biz (B2B SaaS, modern tech platform)
MASTER_SUFFIX = """
modern enterprise SaaS editorial style, clean corporate aesthetic,
soft directional light, premium B2B product feel,
deep navy / electric blue palette (or product brand color),
no people unless lifestyle is core, abstract or product focus,
ultra-sharp details, photorealistic, no logos no text overlay
""".strip().replace('\n', ', ')

def generate_image(prompt: str, aspect_ratio: str = "1:1") -> bytes:
    """
    Generate an image using xAI Grok Imagine.

    Args:
        prompt: The image description (scene only - MASTER_SUFFIX will be appended)
        aspect_ratio: "1:1", "9:16", or "16:9"

    Returns:
        The image data as bytes
    """
    # Check for XAI_API_KEY
    api_key = os.environ.get("XAI_API_KEY")
    if not api_key:
        raise ValueError("XAI_API_KEY environment variable is not set")

    # Combine prompt with master suffix
    full_prompt = f"{prompt}, {MASTER_SUFFIX}"

    # API endpoint
    url = "https://api.x.ai/v1/images/generations"

    # Request payload
    payload = {
        "prompt": full_prompt,
        "model": "grok-imagine-image-quality",
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Make request
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode())

            if 'data' not in data or not data['data']:
                raise ValueError(f"Unexpected response: {data}")

            image = data['data'][0]
            if 'url' in image:
                with urllib.request.urlopen(image['url'], timeout=60) as image_response:
                    return image_response.read()
            if 'b64_json' in image:
                import base64
                return base64.b64decode(image['b64_json'])
            raise ValueError(f"Unexpected image response: {data}")

    except urllib.error.HTTPError as e:
        error_msg = e.read().decode()
        raise RuntimeError(f"xAI API error: {e.code} - {error_msg}")

def save_image(image_bytes: bytes, output_path: str) -> str:
    """Save image bytes to file."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'wb') as f:
        f.write(image_bytes)
    return output_path

def main():
    if len(sys.argv) < 3:
        print("Usage: generate.py <output_path> <prompt> [aspect_ratio]")
        print("  aspect_ratio: 1:1 (default), 9:16, or 16:9")
        sys.exit(1)

    output_path = sys.argv[1]
    prompt = sys.argv[2]
    aspect_ratio = sys.argv[3] if len(sys.argv) > 3 else "1:1"

    print(f"Generating: {output_path}")
    print(f"Prompt: {prompt[:80]}...")
    print(f"Aspect ratio: {aspect_ratio}")

    try:
        image_bytes = generate_image(prompt, aspect_ratio)
        saved_path = save_image(image_bytes, output_path)
        print(f"✓ Saved: {saved_path}")
    except Exception as e:
        print(f"✗ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()