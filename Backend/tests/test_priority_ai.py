import unittest

from app.services.priority_ai import PriorityClassifier


class StubModel:
    def __init__(self, scores=None):
        self.scores = scores

    def predict_scores(self, text):
        return self.scores


class StubVisionModel:
    def analyze(self, **kwargs):
        return None


def build_classifier(model_scores=None):
    classifier = PriorityClassifier()
    classifier._vision_model = StubVisionModel()
    classifier._text_model = StubModel(model_scores)
    classifier._dataset_model = StubModel(None)
    return classifier


class PriorityAITests(unittest.TestCase):
    def test_open_manhole_stays_high_even_when_text_model_prefers_medium(self):
        classifier = build_classifier({"low": 0.05, "medium": 0.85, "high": 0.1})

        prediction = classifier.predict(
            title="Open manhole on busy road",
            description="Manhole cover missing and pedestrians are walking around it.",
            category="drainage",
            severity="medium",
            location="Main road",
        )

        self.assertEqual(prediction.priority, "high")

    def test_live_wire_stays_high_even_when_text_model_prefers_low(self):
        classifier = build_classifier({"low": 0.8, "medium": 0.15, "high": 0.05})

        prediction = classifier.predict(
            title="Live wire sparking near market",
            description="Exposed electric wire is sparking and people may get shock.",
            category="electricity",
            severity="high",
            location="Market entrance",
        )

        self.assertEqual(prediction.priority, "high")

    def test_streetlight_outage_does_not_drop_to_low(self):
        classifier = build_classifier({"low": 0.88, "medium": 0.08, "high": 0.04})

        prediction = classifier.predict(
            title="Streetlight outage",
            description="Streetlight not working on residential lane.",
            category="streetlight",
            severity="medium",
            location="Residential street",
        )

        self.assertEqual(prediction.priority, "medium")

    def test_minor_cosmetic_issue_can_remain_low(self):
        classifier = build_classifier(None)

        prediction = classifier.predict(
            title="Small graffiti on wall",
            description="Small cosmetic graffiti, no obstruction or hateful content.",
            category="graffiti",
            severity="low",
            location="Park wall",
        )

        self.assertEqual(prediction.priority, "low")


if __name__ == "__main__":
    unittest.main()
