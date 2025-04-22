import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import basicAuth from 'express-basic-auth';

// Handle both ESM and CommonJS environments
const __filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const __dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(__filename);

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// In-memory message store - circular buffer pattern
const MAX_MESSAGES = 20;
const messageStore = {
  messages: [],
  addMessage: function(message) {
    // Add timestamp to the message
    const messageWithTimestamp = {
      timestamp: new Date().toISOString(),
      content: message,
      id: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };
    
    // If we've reached capacity, remove the oldest message
    if (this.messages.length >= MAX_MESSAGES) {
      this.messages.shift();
    }
    
    // Add the new message
    this.messages.push(messageWithTimestamp);
    return messageWithTimestamp;
  },
  getAllMessages: function() {
    return [...this.messages]; // Return a copy to prevent direct modification
  },
  clear: function() {
    this.messages = [];
    return { success: true, message: 'Message store cleared' };
  }
};

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
  
  // Also log to console for easy visibility
  console.log(logEntry);
};

// Security middleware
app.use(helmet());

// Logging middleware
app.use(morgan('combined', { stream: accessLogStream }));

// Body parsing middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Authentication middleware for read_messages endpoint
const messageAuth = basicAuth({
  users: { 'admin': 'lifelink' },
  challenge: true,
  realm: 'Message Viewer'
});

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
    const logEntry = `IP: ${sanitizeInput(clientIp)} | Message: ${sanitizedMessage}`;
    
    // Store in memory
    messageStore.addMessage(logEntry);
    
    // Write to log file and console
    logMessage(logEntry);
    
    // Send response
    res.status(200).json({ 
      status: 'success', 
      message: 'Message received and logged' 
    });
  } catch (error) {
    console.error('Error processing message:', error);
    
    // Log the error
    const errorMsg = `ERROR: ${sanitizeInput(error.message)}`;
    messageStore.addMessage(errorMsg);
    logMessage(errorMsg);
    
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to process message' 
    });
  }
});

// Read messages route (with basic auth)
app.get('/read_messages', messageAuth, (req, res) => {
  try {
    const messages = messageStore.getAllMessages();
    
    // Decide on response format based on Accept header
    const acceptHeader = req.headers.accept || '';
    
    if (acceptHeader.includes('application/json')) {
      // Return JSON if requested
      res.json({ messages });
    } else {
      // Default to HTML response
      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Recent Messages</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 1200px;
              margin: 0 auto;
              padding: 20px;
              background: #f5f5f5;
            }
            h1 {
              color: #333;
              border-bottom: 1px solid #ddd;
              padding-bottom: 10px;
            }
            .message {
              background: white;
              border-left: 4px solid #2196F3;
              margin-bottom: 15px;
              padding: 15px;
              border-radius: 3px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              word-break: break-word;
            }
            .message-time {
              color: #666;
              font-size: 0.8em;
              margin-bottom: 5px;
            }
            .message-content {
              white-space: pre-wrap;
            }
            .controls {
              margin: 20px 0;
              display: flex;
              justify-content: space-between;
            }
            button {
              background: #2196F3;
              color: white;
              border: none;
              padding: 10px 15px;
              border-radius: 4px;
              cursor: pointer;
            }
            button:hover {
              background: #0b7dda;
            }
            .empty-message {
              background: #fff3cd;
              padding: 15px;
              border-radius: 3px;
              color: #856404;
              text-align: center;
            }
            @media (max-width: 768px) {
              body {
                padding: 10px;
              }
            }
          </style>
        </head>
        <body>
          <h1>Recent Messages (${messages.length}/${MAX_MESSAGES})</h1>
          
          <div class="controls">
            <button onclick="location.reload()">Refresh</button>
            <button onclick="clearMessages()" style="background: #f44336;">Clear All</button>
          </div>
          
          ${messages.length === 0 ? 
            '<div class="empty-message">No messages yet.</div>' : 
            messages.reverse().map(msg => `
              <div class="message">
                <div class="message-time">${msg.timestamp}</div>
                <div class="message-content">${msg.content}</div>
              </div>
            `).join('')}
          
          <script>
            function clearMessages() {
              if (confirm('Are you sure you want to clear all messages?')) {
                fetch('/clear_messages', { 
                  method: 'POST',
                  headers: {
                    'Authorization': 'Basic ' + btoa('admin:lifelink')
                  }
                })
                .then(response => response.json())
                .then(data => {
                  if (data.success) {
                    location.reload();
                  } else {
                    alert('Failed to clear messages');
                  }
                })
                .catch(error => {
                  console.error('Error:', error);
                  alert('An error occurred');
                });
              }
            }
          </script>
        </body>
        </html>
      `;
      
      res.send(htmlResponse);
    }
  } catch (error) {
    console.error('Error retrieving messages:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to retrieve messages' 
    });
  }
});

// Clear messages route (with basic auth)
app.post('/clear_messages', messageAuth, (req, res) => {
  try {
    const result = messageStore.clear();
    logMessage('Message store cleared by admin');
    res.json(result);
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to clear messages' 
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