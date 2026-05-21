// Shared message splitting utility
export function splitMessage(text, options = {}) {
    const { maxLength = 2000, addContinuationMarker = true, continuationMarker = '\n\n[continued...]' } = options;
    
    if (text.length <= maxLength) {
        return [text];
    }
    
    const chunks = [];
    let remaining = text;
    
    while (remaining.length > maxLength) {
        let splitPoint = remaining.lastIndexOf('\n```\n', maxLength);
        if (splitPoint < maxLength / 2) {
            splitPoint = remaining.lastIndexOf('\n\n', maxLength);
        }
        if (splitPoint < maxLength / 2) {
            splitPoint = remaining.lastIndexOf('\n', maxLength);
        }
        if (splitPoint < maxLength / 2) {
            splitPoint = maxLength;
        }
        chunks.push(remaining.slice(0, splitPoint).trim());
        remaining = remaining.slice(splitPoint).trim();
    }
    
    if (remaining) {
        chunks.push(remaining);
    }
    
    if (addContinuationMarker && chunks.length > 1) {
        for (let i = 0; i < chunks.length - 1; i++) {
            chunks[i] += continuationMarker;
        }
    }
    
    return chunks;
}
