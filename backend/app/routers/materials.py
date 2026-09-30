from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Course, Material
from backend.app.schemas import (
    MaterialCreate,
    MaterialResponse,
    MaterialUpdate,
)

router = APIRouter(
    prefix="/materials",
    tags=["Materials"],
)


@router.post(
    "",
    response_model=MaterialResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_material(
    material_data: MaterialCreate,
    db: Session = Depends(get_db),
):
    course = (
        db.query(Course)
        .filter(Course.id == material_data.course_id)
        .first()
    )

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    material = Material(
        course_id=material_data.course_id,
        title=material_data.title,
        file_name=material_data.file_name,
        file_path=material_data.file_path,
        file_type=material_data.file_type,
        file_size=material_data.file_size,
    )

    db.add(material)
    db.commit()
    db.refresh(material)

    return material


@router.get(
    "/{material_id}",
    response_model=MaterialResponse,
)
def get_material(
    material_id: UUID,
    db: Session = Depends(get_db),
):
    material = (
        db.query(Material)
        .filter(Material.id == material_id)
        .first()
    )

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    return material


@router.get(
    "/course/{course_id}",
    response_model=list[MaterialResponse],
)
def get_course_materials(
    course_id: UUID,
    db: Session = Depends(get_db),
):
    course = (
        db.query(Course)
        .filter(Course.id == course_id)
        .first()
    )

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    materials = (
        db.query(Material)
        .filter(Material.course_id == course_id)
        .order_by(Material.created_at)
        .all()
    )

    return materials


@router.patch(
    "/{material_id}",
    response_model=MaterialResponse,
)
def update_material(
    material_id: UUID,
    material_data: MaterialUpdate,
    db: Session = Depends(get_db),
):
    material = (
        db.query(Material)
        .filter(Material.id == material_id)
        .first()
    )

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    update_data = material_data.model_dump(exclude_unset=True)

    if "course_id" in update_data:
        course = (
            db.query(Course)
            .filter(Course.id == update_data["course_id"])
            .first()
        )

        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )

        material.course_id = update_data["course_id"]

    if "title" in update_data:
        material.title = update_data["title"]

    if "file_name" in update_data:
        material.file_name = update_data["file_name"]

    if "file_path" in update_data:
        material.file_path = update_data["file_path"]

    if "file_type" in update_data:
        material.file_type = update_data["file_type"]

    if "file_size" in update_data:
        material.file_size = update_data["file_size"]

    db.commit()
    db.refresh(material)

    return material


@router.delete(
    "/{material_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_material(
    material_id: UUID,
    db: Session = Depends(get_db),
):
    material = (
        db.query(Material)
        .filter(Material.id == material_id)
        .first()
    )

    if not material:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Material not found",
        )

    db.delete(material)
    db.commit()

    return None