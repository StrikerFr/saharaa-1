-- CHECK constraints treat NULL as pass; wrap shapes in COALESCE(..., false) so missing values are rejected.
ALTER TABLE public.observations DROP CONSTRAINT observation_value_shape;
ALTER TABLE public.observations ADD CONSTRAINT observation_value_shape CHECK (COALESCE(
    (type = 'heart_rate' AND unit = 'bpm' AND value_numeric BETWEEN 20 AND 250 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'blood_pressure' AND unit = 'mmHg' AND value_numeric BETWEEN 50 AND 260 AND value_numeric_2 BETWEEN 30 AND 160 AND value_numeric > value_numeric_2 AND value_text IS NULL) OR
    (type = 'weight' AND unit = 'kg' AND value_numeric BETWEEN 20 AND 300 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'sleep_duration' AND unit = 'h' AND value_numeric BETWEEN 0 AND 24 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'mobility' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('independent', 'uses_aid', 'needs_assistance', 'bed_bound')) OR
    (type IN ('appetite', 'hydration') AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('usual', 'reduced', 'increased', 'refused')) OR
    (type = 'medication_event' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('taken', 'partially_taken', 'missed', 'refused')) OR
    (type = 'care_note' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IS NULL AND note IS NOT NULL AND length(btrim(note)) >= 3),
  false));

ALTER TABLE public.senior_baselines DROP CONSTRAINT baseline_value_shape;
ALTER TABLE public.senior_baselines ADD CONSTRAINT baseline_value_shape CHECK (COALESCE(
    (status <> 'recorded' AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IS NULL AND unit IS NULL)
    OR (status = 'recorded' AND (
      (field = 'resting_heart_rate' AND unit = 'bpm' AND value_numeric BETWEEN 20 AND 250 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
      (field = 'blood_pressure' AND unit = 'mmHg' AND value_numeric BETWEEN 50 AND 260 AND value_numeric_2 BETWEEN 30 AND 160 AND value_numeric > value_numeric_2 AND value_text IS NULL) OR
      (field = 'weight' AND unit = 'kg' AND value_numeric BETWEEN 20 AND 300 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
      (field = 'mobility' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('independent', 'uses_aid', 'needs_assistance', 'bed_bound')) OR
      (field IN ('hearing', 'vision') AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('no_difficulty', 'some_difficulty', 'significant_difficulty', 'uses_device'))
    )),
  false));