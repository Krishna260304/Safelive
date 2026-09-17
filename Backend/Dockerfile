FROM python:3.10-slim
WORKDIR /app
COPY Backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cu121
COPY Backend/ .
COPY synthetic_complaints_datechange.csv civic_issues_with_severity-1.csv ./
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
