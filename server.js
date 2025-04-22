// server.js (updated for compatibility with both direct Node.js and Vite)
import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';

// Handle both ESM and CommonJS environments
const __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up logging directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create a custom logging stream for Morgan
const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'), 
  { flags: 'a' }
);

// Create a message logging function
const logMessage = (message) => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  
  fs.appendFile(
    path.join(logsDir, 'messages.log'),
    logEntry,
    (err) => {
      if (err) console.error('Error writing to message log:', err);
    }
  );
};

// Security middleware
app.use(helmet());

// Logging middleware
app.use(morgan('combined', { stream: accessLogStream }));

// Body parsing middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Simple security function to sanitize input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') {
    return JSON.stringify(input);
  }
  
  // Remove potentially dangerous characters
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\$/g, '&#36;')
    .replace(/;/g, '&#59;');
};

// Health route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Message route
app.post('/message', (req, res) => {
  try {
    // Get the message from request body
    const rawMessage = req.body.message || 'No message provided';
    
    // Sanitize the message
    const sanitizedMessage = sanitizeInput(rawMessage);
    
    // Log source IP and sanitized message
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const logMessage = `IP: ${sanitizeInput(clientIp)} | Message: ${sanitizedMessage}`;
    
    // Write to log file
    logMessage(logMessage);
    
    // Send response
    res.status(200).json({ 
      status: 'success', 
      message: 'Message received and logged' 
    });
  } catch (error) {
    console.error('Error processing message:', error);
    
    // Log the error
    logMessage(`ERROR: ${sanitizeInput(error.message)}`);
    
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to process message' 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// Start the server if not imported as a module
if (import.meta.url === `file://${__filename}`) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    logMessage('Server started');
  });
}

// Export for use with Vite or other modules
export default app;