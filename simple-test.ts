const express = require(express);

const app = express();
app.get(/api/health, (req, res) => {
  res.json({ status: ok, test: true });
});

app.listen(3000, 0.0.0.0, () => {
  console.log(Simple test server running on port 3000);
});
