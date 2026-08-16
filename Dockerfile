# Use official Python lightweight image
FROM python:3.10-slim

# Install 7-Zip (required for .cbr support)
RUN apt-get update && \
    apt-get install -y p7zip-full && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your application
COPY . .

# Expose port (Render expects web services to listen on a port, 10000 is common default)
EXPOSE 10000

# Start app with Gunicorn
# --timeout 120 ensures Google Drive large file downloads don't time out
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:10000", "--workers", "2", "--timeout", "120"]