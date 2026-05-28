# Captcha Training Data Collection

This feature automatically collects successful captcha validations to create a training dataset for AI model development.

## Overview

When users successfully validate university documents with correct captcha inputs, the system automatically saves:

1. **Captcha Image**: The original captcha image (Base64 → JPEG)
2. **User Input**: The correct text input provided by the user
3. **Metadata**: Session information, timestamps, and validation context

## Data Storage

Training data is stored in: `/backend/captcha-training-data/`

### File Structure

For each successful validation, the system creates:

```
captcha-training-data/
├── captcha_2025-08-03T18-56-00-000Z_b66syjj0.jpg    # Captcha image
├── captcha_2025-08-03T18-56-00-000Z_b66syjj0.json   # Metadata
└── training_log.txt                                  # Consolidated log
```

### Metadata Format

Each `.json` file contains:

```json
{
  "sessionId": "b66syjj0hmmdw7x3ra",
  "userId": "9a06faf8***",
  "userInput": "ABC123",
  "imagePath": "/path/to/captcha_2025-08-03T18-56-00-000Z_b66syjj0.jpg",
  "timestamp": "2025-08-03T18:56:00.000Z",
  "imageSize": 15432,
  "inputLength": 6,
  "source": "unesp-captcha-validation"
}
```

### Training Log Format

The `training_log.txt` file contains tab-separated values:

```
timestamp	userInput	imageFile	sessionId
2025-08-03T18-56-00-000Z	ABC123	captcha_2025-08-03T18-56-00-000Z_b66syjj0.jpg	b66syjj0hmmdw7x3ra
```

## Privacy & Security

- **User ID Anonymization**: Only first 8 characters of user ID + `***` are stored
- **No Personal Data**: Only captcha images and correct inputs are collected
- **Automatic Collection**: No additional user consent required for technical validation data
- **Local Storage**: Data is stored locally on the server, not transmitted externally

## AI Training Usage

This dataset can be used to:

1. **Train OCR Models**: Improve automatic captcha reading capabilities
2. **Reduce User Friction**: Potentially eliminate manual captcha input in the future
3. **Improve Validation**: Create more accurate document validation systems
4. **Analytics**: Understand captcha success/failure patterns

## Technical Implementation

- **Async Collection**: Training data collection runs asynchronously and doesn't block validation
- **Error Handling**: Collection failures don't affect main validation flow
- **Performance**: Minimal impact on system performance
- **Extensible**: Easy to add more metadata or change storage format

## Data Processing

To process the collected data for AI training:

1. Load images and corresponding text labels
2. Normalize image formats and sizes
3. Split data into training/validation/test sets
4. Train OCR or captcha-solving models

## Monitoring

Check logs for training data collection status:

- Successful collection: `"Saved captcha training data: filename"`
- Failures: `"Failed to save captcha training data: error"`

The system continues normal operation regardless of training data collection status.
