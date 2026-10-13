"""Apply reviewed textbook indexes without changing question identity or content."""
import copy
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load_source_index():
    path = Path(__file__).with_name('source-index.json')
    return json.loads(path.read_text(encoding='utf-8'))['subjects']


def apply_source_index(subject_key, subject):
    """Update source fields and reviewed within-chapter section assignments in place.

    A question may teach a prerequisite from another chapter. Its exercise group
    stays intact; ``source.chapter`` and ``source.section`` identify that actual
    reading location. Newly authored questions keep their own source indexes.
    """
    overrides = load_source_index().get(subject_key, {})
    groups = [chapter.get('items', []) for chapter in subject.get('chapters', [])]
    groups.append(subject.get('questions', []))
    seen = set()
    changed = 0
    for questions in groups:
        for question in questions:
            item = overrides.get(question.get('id'))
            if item is None:
                continue
            question['source'] = copy.deepcopy(item['source'])
            for field in ('studySection', 'sectionNumber'):
                if field in item:
                    question[field] = item[field]
            if question['id'] not in seen:
                seen.add(question['id'])
                changed += 1
    return changed
