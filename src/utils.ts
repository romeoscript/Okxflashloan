import fs from 'fs';
import path from 'path';

export async function storeData(filePath: string, data: any): Promise<void> {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Read existing data if file exists
    let existingData: any[] = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      existingData = JSON.parse(fileContent);
    }

    // Add new data
    existingData.push(data);

    // Write back to file
    await fs.promises.writeFile(filePath, JSON.stringify(existingData, null, 2));
  } catch (error) {
    console.error('Error storing data:', error);
    throw error;
  }
} 